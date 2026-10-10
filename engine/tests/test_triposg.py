"""TripoSG engine: own networks, weight-name mapping and surface extraction (no weights needed)."""

from pathlib import Path

import numpy as np
import pytest
import torch
from PIL import Image

from photo3d_engine.engines import triposg
from photo3d_engine.engines.registry import get_engine
from photo3d_engine.engines.triposg_net import (
    FlowTransformer,
    ShapeDecoder,
    decoder_renames,
    flow_renames,
    load_weights,
    point_features,
)


def block_keys(prefix: str, self_attn: bool, cross: bool, qk_norm: bool, skip: bool):
    """Tensor names of one block, written the way the published weight files name them."""
    both = ("weight", "bias")
    keys = []
    attns = (["attn1"] if self_attn else []) + (["attn2"] if cross else [])
    for attn in attns:
        keys += [f"{attn}.to_{x}.weight" for x in "qkv"] + [f"{attn}.to_out.0.{p}" for p in both]
        if qk_norm:
            keys += [f"{attn}.norm_q.weight", f"{attn}.norm_k.weight"]
    if cross and not qk_norm:
        keys += [f"attn2.norm_cross.{p}" for p in both]
    norms = (["norm1"] if self_attn else []) + (["norm2"] if cross else []) + ["norm3"]
    skips = ["skip_linear", "skip_norm"] if skip else []
    with_bias = norms + ["ff.net.0.proj", "ff.net.2"] + skips
    keys += [f"{name}.{p}" for name in with_bias for p in both]
    return [prefix + key for key in keys]


def flow_file_keys(layers: int) -> list[str]:
    keys = []
    for i in range(layers):
        keys += block_keys(f"blocks.{i}.", True, True, True, i > layers // 2)
    top = ["norm_out", "proj_in", "proj_out", "time_proj.linear_1", "time_proj.linear_2"]
    return keys + [f"{name}.{p}" for name in top for p in ("weight", "bias")]


def decoder_file_keys(layers: int) -> list[str]:
    keys = []
    for i in range(layers):
        keys += block_keys(f"decoder.blocks.{i}.", True, False, False, False)
    keys += block_keys(f"decoder.blocks.{layers}.", False, True, False, False)
    top = ["decoder.norm_out", "decoder.proj_out", "decoder.proj_query", "post_quant", "quant"]
    keys += [f"{name}.{p}" for name in top for p in ("weight", "bias")]
    return keys + ["encoder.proj_in.weight", "encoder.blocks.0.attn2.to_q.weight"]


def test_published_names_cover_the_full_size_networks_exactly():
    with torch.device("meta"):
        flow, decoder = FlowTransformer(), ShapeDecoder()
    flow_keys = flow_file_keys(21)
    assert len(flow_keys) == 554  # the count in the real transformer file
    assert {flow_renames(k) for k in flow_keys} == set(flow.state_dict())

    mapped = {decoder_renames(k) for k in decoder_file_keys(16)} - {None}
    assert mapped == set(decoder.state_dict())
    assert decoder_renames("encoder.proj_in.weight") is None  # not needed for making shapes
    assert decoder_renames("quant.weight") is None
    assert decoder_renames("decoder.blocks.16.attn2.norm_cross.weight") == (
        "query.cross_attn.norm_context.weight"
    )
    assert decoder_renames("decoder.blocks.16.norm2.weight") == "query.norm_cross.weight"


def save_under_published_names(model, file_keys, rename, path: Path):
    from safetensors.torch import save_file

    own = model.state_dict()
    tensors = {}
    for key in file_keys:
        new = rename(key)
        tensors[key] = torch.randn(own[new].shape) if new else torch.zeros(1)
    save_file(tensors, str(path))
    return tensors


def test_load_weights_puts_every_tensor_in_its_place(tmp_path):
    flow = FlowTransformer(width=64, heads=4, layers=5, token_dim=8, image_dim=32)
    path = tmp_path / "flow.safetensors"
    saved = save_under_published_names(flow, flow_file_keys(5), flow_renames, path)
    load_weights(flow, path, flow_renames, torch.float32)
    assert torch.equal(flow.blocks[4].skip_in.weight, saved["blocks.4.skip_linear.weight"])
    assert torch.equal(flow.time_in.bias, saved["time_proj.linear_1.bias"])

    decoder = ShapeDecoder(width=64, heads=4, layers=2, token_dim=8)
    path = tmp_path / "vae.safetensors"
    keys = decoder_file_keys(2)
    rename = lambda k: decoder_renames(k, query_block=2)  # noqa: E731
    saved = save_under_published_names(decoder, keys, rename, path)
    load_weights(decoder, path, rename, torch.float32)
    assert torch.equal(
        decoder.query.cross_attn.norm_context.weight,
        saved["decoder.blocks.2.attn2.norm_cross.weight"],
    )


def test_load_weights_refuses_a_file_that_does_not_fit(tmp_path):
    from safetensors.torch import save_file

    path = tmp_path / "wrong.safetensors"
    save_file({"something.else": torch.zeros(3)}, str(path))
    with pytest.raises(RuntimeError, match="do not fit"):
        load_weights(FlowTransformer(64, 4, 3, 8, 32), path, flow_renames, torch.float32)


def test_small_networks_give_the_right_shapes():
    flow = FlowTransformer(width=64, heads=4, layers=5, token_dim=8, image_dim=32).eval()
    tokens = torch.randn(2, 10, 8)
    out = flow(tokens, torch.tensor([1000.0, 10.0]), torch.randn(2, 7, 32))
    assert out.shape == tokens.shape

    decoder = ShapeDecoder(width=64, heads=4, layers=2, token_dim=8).eval()
    memory = decoder.memory(torch.randn(1, 10, 8))
    assert decoder.occupancy(memory, torch.rand(1, 50, 3)).shape == (1, 50)


def test_point_features_layout():
    features = point_features(torch.tensor([[0.5, 0.0, 1.0]]))
    assert features.shape == (1, 51)
    assert torch.allclose(features[0, :3], torch.tensor([0.5, 0.0, 1.0]))
    # sines of x come first: x * 1, x * 2, ... x * 128
    assert torch.allclose(features[0, 3:5], torch.sin(torch.tensor([0.5, 1.0])))


def sphere(points: torch.Tensor, cancelled=lambda: False, radius: float = 0.6) -> torch.Tensor:
    """Stand-in for the decoder: positive inside a sphere, like real occupancy logits."""
    return (radius - points.norm(dim=-1)) * 20


def test_surface_from_coarse_to_fine_is_a_closed_sphere():
    coarse = 33
    field = sphere(triposg.grid_points(coarse, "cpu", torch.float32)).reshape((coarse,) * 3)
    asked = []

    def counting(points, cancelled):
        asked.append(len(points))
        return sphere(points)

    fine = triposg.refine(field, counting, triposg.REFINE_BAND, lambda: False)
    assert fine.shape == (65, 65, 65)
    assert 0 < asked[0] < 65**3 / 2  # only the shell near the surface is asked again
    mesh = triposg.surface_mesh(fine)
    assert mesh.is_watertight and mesh.volume > 0
    assert mesh.volume == pytest.approx(4 / 3 * np.pi * 0.6**3, rel=0.03)


def test_refine_stops_when_cancelled():
    from photo3d_engine.engines.base import Cancelled

    field = sphere(triposg.grid_points(17, "cpu", torch.float32)).reshape(17, 17, 17)

    def cancelling(points, cancelled):
        if cancelled():
            raise Cancelled()
        return sphere(points)

    with pytest.raises(Cancelled):
        triposg.refine(field, cancelling, triposg.REFINE_BAND, lambda: True)


def test_photo_goes_on_white_and_dino_gets_224_pixels():
    rgba = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    rgba.paste((255, 0, 0, 255), (200, 200, 300, 300))
    photo = triposg.prepare_photo(rgba)
    assert photo.mode == "RGB"
    assert photo.getpixel((5, 5)) == (255, 255, 255) and photo.getpixel((250, 250)) == (255, 0, 0)
    assert triposg.dino_pixels(photo).shape == (1, 3, 224, 224)


def test_engine_facts():
    engine = get_engine("triposg")
    assert engine.license == "MIT" and engine.gated is False
    assert engine.up_axis == "y" and engine.download_gb > 5
    with pytest.raises(RuntimeError, match="load"):
        engine.run(Path("x.png"), Path("."), {}, lambda *_: None, lambda: False)


@pytest.mark.slow
def test_real_triposg_makes_a_printable_stl(tmp_path):
    from photo3d_engine.make import make_stl

    if not get_engine("triposg").is_installed():
        pytest.skip("TripoSG weights are not downloaded (run: photo3d install --engine triposg)")
    sample = Path(__file__).resolve().parents[2] / "samples" / "chair.png"
    result = make_stl(
        sample, tmp_path / "chair.stl", height_mm=50, quality="fast", engine_id="triposg"
    )
    assert result.report["watertight"] and result.report["bodies"] == 1
    assert result.report["size_mm"][2] == pytest.approx(50, abs=0.5)
