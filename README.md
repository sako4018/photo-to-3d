# photo-to-3d

Desktop приложение за macOS (Windows по-късно), което от снимка прави STL файл, готов за принтиране: затворен, в мм, с равна основа и директно към слайсъра. Работи локално, без облак.

## Статус

Работи само Python engine-ът с команден ред (CLI). Desktop приложението (Electron) още не е започнато.
Подробният план е в [docs/PLAN.md](docs/PLAN.md), а измерванията са в [docs/benchmarks.md](docs/benchmarks.md).

## Как се пуска (macOS)

Еднократно:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh      # инсталира uv
cd "$HOME/Desktop/Developer/personal projects/photo-to-3d"
uv run --project engine photo3d install              # сваля модела TripoSR, около 1.7 GB
```

Снимка → STL:

```bash
uv run --project engine photo3d make samples/chair.png --height 50
```

За всяка снимка се прави отделна папка в `out/`, в която стои всичко за нея:

```
out/chair/
  original.png        снимката, копирана без промяна
  chair_50mm.stl      готовият за печат модел
  report.txt          доклад: затворен ли е, размери, обем, грамове PLA
  details/            изрязаната снимка и суровият модел (за проверка)
```

- Същата снимка пак отива в същата папка (друга височина дава втори STL до първия).
- Друга снимка със същото име получава нова папка (`chair-2`), така че нищо не се презаписва.
- `--out ПАПКА` сменя мястото вместо `out/`. `--out файл.stl` записва само един STL, без папка.

Опции: `--height` (мм), `--quality fast|normal|detailed`, `--device auto|cpu|mps|cuda`, `--no-remove-bg` (снимката вече е без фон).

В края се печата същият доклад: затворен ли е, размери в мм, обем, приблизителни грамове PLA, време по етапи и пик на паметта.

## Тестове

```bash
cd engine
uv run pytest            # бързи тестове, без AI модел
uv run pytest -m slow    # бавни тестове с истински модел (нужни са свалени тегла)
uv run ruff check .
```

## Лицензи

TripoSR е вграден от https://github.com/VAST-AI-Research/TripoSR под MIT лиценз, виж `engine/src/photo3d_engine/engines/triposr_vendor/NOTICE.md`.
