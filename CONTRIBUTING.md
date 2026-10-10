# Contributing

Thanks for looking. The project is small and still early: only the command line works, the app with a window comes next (see [docs/PLAN.md](docs/PLAN.md), in Bulgarian).

## Set up

You need macOS on Apple Silicon and [uv](https://docs.astral.sh/uv/). Python 3.11 is installed by uv.

```bash
cd engine
uv sync
```

## Run the checks

From the `engine/` folder:

```bash
uv run pytest                 # fast tests, no AI model needed
uv run pytest -m slow         # slow tests, need the model weights (about 8 GB, see the README)
uv run ruff check --config pyproject.toml . ../scripts
uv run ruff format --check --config pyproject.toml . ../scripts
```

All of these must pass before a change is merged. The CI runs the first, third and fourth.

## Making changes

- Keep commits small, one clear step each. Write the message in English, in the imperative: `Add input validation to the CLI`.
- Add or update a test with the change. The print-preparation tests use hand-made broken meshes and need no model.
- Do not commit model weights, `out/` or `.venv/`. They are in `.gitignore`.
- Do not copy code from the TripoSG repository into `engines/triposg_net.py` or `engines/triposg.py`: parts of it are under Tencent licenses that exclude the EU (see `docs/decisions/006-triposg-own-code.md`).
- Do not rewrite history that others may have pulled (no force push).

## Reporting a problem

Open an issue and include your Mac model and RAM, the command you ran, the report the command printed, and, if you can share it, the photo. Please say honestly what you did not check.
