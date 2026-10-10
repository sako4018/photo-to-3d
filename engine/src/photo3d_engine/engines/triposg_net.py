"""The two TripoSG networks, written for this project in plain PyTorch.

TripoSG (VAST-AI, weights under MIT on Hugging Face) is a diffusion model for 3D shapes:

* a "flow" transformer turns random noise into 2048 shape tokens (64 numbers each),
  looking at DINOv2 features of the photo on every step;
* a shape decoder answers "how much inside the object is this 3D point?" for any point,
  given those tokens.

This file only rebuilds the maths that the published weights expect. No code from the
TripoSG repository is used here (parts of it are under Tencent licences that exclude the
EU). Tensor names in the weight files differ from the names below; `load_weights` maps them.
"""

from __future__ import annotations

import math
from pathlib import Path

import torch
import torch.nn.functional as F
from torch import nn

LAYER_NORM_EPS = 1e-5
QK_NORM_EPS = 1e-6


def layer_norm(x: torch.Tensor, norm: nn.LayerNorm) -> torch.Tensor:
    """Layer norm done in float32 (half precision loses too much here), result in x's type."""
    out = F.layer_norm(
        x.float(), norm.normalized_shape, norm.weight.float(), norm.bias.float(), norm.eps
    )
    return out.to(x.dtype)


class HeadNorm(nn.Module):
    """RMS normalisation of every attention head's vector, with a learned scale."""

    def __init__(self, size: int) -> None:
        super().__init__()
        self.weight = nn.Parameter(torch.ones(size))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x32 = x.float()
        x32 = x32 * torch.rsqrt(x32.pow(2).mean(-1, keepdim=True) + QK_NORM_EPS)
        return (x32 * self.weight.float()).to(x.dtype)


class Attention(nn.Module):
    """Multi-head attention. Self-attention when `context` is None, else cross-attention.

    The weights were trained with an unusual head layout: q, k and v are joined end to end
    and then cut into heads, so one head's q, k and v come from neighbouring columns.
    `_heads` repeats that layout exactly, otherwise the weights would not fit.
    """

    def __init__(
        self,
        dim: int,
        heads: int,
        context_dim: int | None = None,
        head_norm: bool = False,
        context_norm: bool = False,
    ) -> None:
        super().__init__()
        self.heads = heads
        self.head_dim = dim // heads
        self.is_cross = context_dim is not None
        kv_dim = context_dim or dim
        self.to_q = nn.Linear(dim, dim, bias=False)
        self.to_k = nn.Linear(kv_dim, dim, bias=False)
        self.to_v = nn.Linear(kv_dim, dim, bias=False)
        self.to_out = nn.Linear(dim, dim)
        self.norm_q = HeadNorm(self.head_dim) if head_norm else None
        self.norm_k = HeadNorm(self.head_dim) if head_norm else None
        self.norm_context = nn.LayerNorm(kv_dim, eps=LAYER_NORM_EPS) if context_norm else None

    def _heads(self, x: torch.Tensor, context: torch.Tensor):
        batch, length = x.shape[0], x.shape[1]
        if not self.is_cross:
            joined = torch.cat([self.to_q(x), self.to_k(x), self.to_v(x)], dim=-1)
            q, k, v = joined.view(batch, length, self.heads, 3, self.head_dim).unbind(3)
        else:
            q = self.to_q(x).view(batch, length, self.heads, self.head_dim)
            joined = torch.cat([self.to_k(context), self.to_v(context)], dim=-1)
            k, v = joined.view(batch, context.shape[1], self.heads, 2, self.head_dim).unbind(3)
        return q.transpose(1, 2), k.transpose(1, 2), v.transpose(1, 2)

    def forward(self, x: torch.Tensor, context: torch.Tensor | None = None) -> torch.Tensor:
        if context is None:
            context = x
        elif self.norm_context is not None:
            context = layer_norm(context, self.norm_context)
        q, k, v = self._heads(x, context)
        if self.norm_q is not None:
            q, k = self.norm_q(q), self.norm_k(k)
        out = F.scaled_dot_product_attention(q, k, v)
        out = out.transpose(1, 2).reshape(x.shape[0], x.shape[1], -1)
        return self.to_out(out)


class FeedForward(nn.Module):
    def __init__(self, dim: int, hidden: int) -> None:
        super().__init__()
        self.inner = nn.Linear(dim, hidden)
        self.outer = nn.Linear(hidden, dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.outer(F.gelu(self.inner(x)))


class Block(nn.Module):
    """Pre-norm transformer block: [long skip] -> self-attn -> cross-attn -> feed-forward."""

    def __init__(
        self,
        dim: int,
        heads: int,
        self_attention: bool = True,
        context_dim: int | None = None,
        head_norm: bool = False,
        context_norm: bool = False,
        long_skip: bool = False,
    ) -> None:
        super().__init__()
        self.norm_self = nn.LayerNorm(dim, eps=LAYER_NORM_EPS) if self_attention else None
        self.self_attn = Attention(dim, heads, head_norm=head_norm) if self_attention else None
        if context_dim is not None:
            self.norm_cross = nn.LayerNorm(dim, eps=LAYER_NORM_EPS)
            self.cross_attn = Attention(dim, heads, context_dim, head_norm, context_norm)
        else:
            self.norm_cross = self.cross_attn = None
        self.norm_ff = nn.LayerNorm(dim, eps=LAYER_NORM_EPS)
        self.ff = FeedForward(dim, 4 * dim)
        if long_skip:
            self.skip_in = nn.Linear(2 * dim, dim)
            self.skip_norm = nn.LayerNorm(dim, eps=LAYER_NORM_EPS)
        else:
            self.skip_in = self.skip_norm = None

    def forward(
        self,
        x: torch.Tensor,
        context: torch.Tensor | None = None,
        skip: torch.Tensor | None = None,
    ) -> torch.Tensor:
        if self.skip_in is not None:
            # the earlier activation goes first, then the current one
            x = layer_norm(self.skip_in(torch.cat([skip, x], dim=-1)), self.skip_norm)
        if self.self_attn is not None:
            x = x + self.self_attn(layer_norm(x, self.norm_self))
        if self.cross_attn is not None:
            x = x + self.cross_attn(layer_norm(x, self.norm_cross), context)
        return x + self.ff(layer_norm(x, self.norm_ff))


def timestep_features(t: torch.Tensor, size: int) -> torch.Tensor:
    """Sine/cosine features of the diffusion time t (0..1000), sines first."""
    half = size // 2
    freqs = torch.exp(-math.log(10000.0) * torch.arange(half, device=t.device) / half)
    angles = t.float()[:, None] * freqs[None, :]
    return torch.cat([angles.sin(), angles.cos()], dim=-1)


class FlowTransformer(nn.Module):
    """Predicts the velocity that moves the shape tokens from noise towards the shape.

    U-shaped: the outputs of the first half of the blocks are fed again into the mirrored
    blocks of the second half. The time step travels as one extra token in front.
    """

    def __init__(
        self,
        width: int = 2048,
        heads: int = 16,
        layers: int = 21,
        token_dim: int = 64,
        image_dim: int = 1024,
    ) -> None:
        super().__init__()
        self.width = width
        self.time_in = nn.Linear(width, 4 * width)
        self.time_out = nn.Linear(4 * width, width)
        self.proj_in = nn.Linear(token_dim, width)
        middle = layers // 2
        self.blocks = nn.ModuleList(
            Block(width, heads, context_dim=image_dim, head_norm=True, long_skip=i > middle)
            for i in range(layers)
        )
        self.norm_out = nn.LayerNorm(width, eps=LAYER_NORM_EPS)
        self.proj_out = nn.Linear(width, token_dim)

    def forward(self, tokens: torch.Tensor, t: torch.Tensor, image: torch.Tensor) -> torch.Tensor:
        count = tokens.shape[1]
        time = timestep_features(t, self.width).to(tokens.dtype)
        time = self.time_out(F.gelu(self.time_in(time)))
        x = torch.cat([time[:, None, :], self.proj_in(tokens)], dim=1)

        middle = len(self.blocks) // 2
        saved = []
        for index, block in enumerate(self.blocks):
            skip = saved.pop() if index > middle else None
            x = block(x, image, skip)
            if index < middle:
                saved.append(x)
        x = layer_norm(x, self.norm_out)
        return self.proj_out(x[:, -count:])


def point_features(points: torch.Tensor, octaves: int = 8) -> torch.Tensor:
    """xyz, then sin and cos of xyz at 1, 2, 4, ... 2^(octaves-1) (per axis, axis-major)."""
    scales = 2.0 ** torch.arange(octaves, device=points.device, dtype=points.dtype)
    scaled = (points[..., None] * scales).flatten(-2)
    return torch.cat([points, scaled.sin(), scaled.cos()], dim=-1)


class ShapeDecoder(nn.Module):
    """Shape tokens in, occupancy of arbitrary 3D points out (positive = inside)."""

    def __init__(
        self, width: int = 1024, heads: int = 8, layers: int = 16, token_dim: int = 64
    ) -> None:
        super().__init__()
        self.tokens_in = nn.Linear(token_dim, width)
        self.blocks = nn.ModuleList(Block(width, heads) for _ in range(layers))
        self.points_in = nn.Linear(3 * (2 * 8 + 1), width)
        self.query = Block(width, heads, self_attention=False, context_dim=width, context_norm=True)
        self.norm_out = nn.LayerNorm(width, eps=LAYER_NORM_EPS)
        self.proj_out = nn.Linear(width, 1)

    def memory(self, tokens: torch.Tensor) -> torch.Tensor:
        """Run once per shape; `occupancy` then only needs the cheap last step."""
        x = self.tokens_in(tokens)
        for block in self.blocks:
            x = block(x)
        return x

    def occupancy(self, memory: torch.Tensor, points: torch.Tensor) -> torch.Tensor:
        x = self.points_in(point_features(points.to(memory.dtype)))
        x = self.query(x, memory)
        # the trained output is "outside-ness"; flip it so that inside is positive
        return -self.proj_out(layer_norm(x, self.norm_out))[..., 0]


# --- loading the published weights -------------------------------------------------------

# applied in this order (the attention's own context norm goes first, before "norm2" of
# the block is renamed to "norm_cross")
_SHARED_RENAMES = [
    (".attn2.norm_cross.", ".cross_attn.norm_context."),
    (".attn1.", ".self_attn."),
    (".attn2.", ".cross_attn."),
    (".norm1.", ".norm_self."),
    (".norm2.", ".norm_cross."),
    (".norm3.", ".norm_ff."),
    (".to_out.0.", ".to_out."),
    (".ff.net.0.proj.", ".ff.inner."),
    (".ff.net.2.", ".ff.outer."),
    (".skip_linear.", ".skip_in."),
]


def _rename(key: str) -> str:
    key = "." + key
    for old, new in _SHARED_RENAMES:
        key = key.replace(old, new)
    return key[1:]


def flow_renames(key: str) -> str | None:
    key = _rename(key)
    key = key.replace("time_proj.linear_1.", "time_in.").replace("time_proj.linear_2.", "time_out.")
    return key


def decoder_renames(key: str, query_block: int = 16) -> str | None:
    if not (key.startswith("decoder.") or key.startswith("post_quant.")):
        return None  # the encoder half of the auto-encoder is not needed to make shapes
    key = key.replace("post_quant.", "tokens_in.", 1)
    key = key.replace("decoder.proj_query.", "points_in.", 1)
    key = key.replace(f"decoder.blocks.{query_block}.", "query.", 1)
    key = key.removeprefix("decoder.")
    return _rename(key)


def load_weights(model: nn.Module, path: Path, rename, dtype: torch.dtype) -> None:
    """Load a .safetensors file into `model`; every expected tensor must be found."""
    from safetensors import safe_open

    state = {}
    with safe_open(str(path), framework="pt") as weights:
        for key in weights.keys():
            new_key = rename(key)
            if new_key is not None:
                state[new_key] = weights.get_tensor(key).to(dtype)
    missing, unexpected = model.load_state_dict(state, strict=False)
    if missing or unexpected:
        raise RuntimeError(
            f"Weights in {path.name} do not fit: missing {missing[:5]}, unexpected {unexpected[:5]}"
        )
