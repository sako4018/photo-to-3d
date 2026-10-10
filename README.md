# photo-to-3d

[![CI](https://github.com/sako4018/photo-to-3d/actions/workflows/ci.yml/badge.svg)](https://github.com/sako4018/photo-to-3d/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

🇬🇧 [English version](README.en.md)

Програма, която от **една снимка** на предмет прави **3D модел във формат STL, готов за принтиране**: затворен, в милиметри, с равна основа. Работи изцяло на твоя компютър, без облак и без акаунт.

За хора с 3D принтер, които искат бързо да превърнат снимка на фигурка, играчка или подарък в модел за слайсъра, без да учат Blender. Засега работи само на Mac с Apple Silicon.

![Мече: снимка, махнат фон, 3D модел](docs/images/teddy.png)
![Джудже: снимка, махнат фон, 3D модел](docs/images/gnome.png)

*Снимки: [Steiff Teddy Bear.jpg](https://commons.wikimedia.org/wiki/File:Steiff_Teddy_Bear.jpg) и [German garden gnome.jpg](https://commons.wikimedia.org/wiki/File:German_garden_gnome.jpg) от Wikimedia Commons, обществено достояние (по данните на Commons). 3D изгледът е нарисуван от `scripts/make_readme_images.py`.*

## Какво е готово и какво предстои

Работи **командният ред**: даваш снимка и получаваш папка със затворен STL, доклад за размерите и приблизителните грамове PLA. **Приложение с прозорец още няма.** Следват FastAPI сървър и Electron приложение, където избираш или влачиш снимка и виждаш модела. Планът е в [docs/PLAN.md](docs/PLAN.md).

## Как ще работи (планирано)

> Това е план, не готово. Нищо от списъка още не съществува, а подробностите по сайта и по инсталатора още не са решени.

1. Малък сайт със снимка "преди / след" и бутон "Свали за Mac".
2. Сваля се един файл (`.dmg`) и се отваря като обикновено Mac приложение.
3. Първото пускане довършва инсталацията: сваля модела (около 2 GB), с прогрес.
4. В приложението избираш файл със снимка (или го влачиш) и натискаш "Създай".
5. Приложението прави 3D вариант (STL), показва го и го записва в папка до снимката.

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

## Ограничения

Числата са от [docs/benchmarks.md](docs/benchmarks.md), измерени на **MacBook Pro M1 Pro с 16 GB RAM**. На друга машина не е пробвано.

- **Само Apple Silicon.** Тестван е един компютър. Windows, Intel Mac и NVIDIA не са тествани.
- **Меки детайли и тънки краища.** Формите се разпознават, но роботът губи ръцете, фламингото и столът имат много тънки крака, а козината и плетката се загладяват. При мечето 3D моделът е по-"буцест" от снимката.
- **Малък контакт с плочата.** Когато предметът стъпва на тънки върхове, равната основа е малка. При стола е около 6.4 мм². Такъв модел в слайсъра ще иска brim или поддръжки.
- **Нищо не е печатано** и STL файловете не са отваряни в слайсър. Валидността (затворен, правилен размер в мм) е проверена само с библиотеката trimesh.
- **Малко тествани снимки.** Общо 7: 5 чисти рендера и 2 истински снимки на предмети с обществено достояние. Лоши снимки (силни сенки, отблясъци, прозрачни предмети) още не са пробвани.
- **Оценката за грамове е груба**, не резултат на слайсър.
- **Времена (M1 Pro, "normal"):** около 16 s на снимка на MPS (GPU на Apple) и около 21 s на CPU, с пик на паметта 3.7–4.3 GB. "fast" е около 9 s, "detailed" около 22 s.
- **Изтеглянето е голямо:** моделът е около 1.7 GB, а средата на Python (PyTorch) около 1.1 GB.

## Тестове

```bash
cd engine
uv run pytest            # бързи тестове, без AI модел
uv run pytest -m slow    # бавни тестове с истински модел (нужни са свалени тегла)
uv run ruff check .
```

## Документи

- [docs/PLAN.md](docs/PLAN.md): пълният план и roadmap
- [docs/benchmarks.md](docs/benchmarks.md): измервания и открития
- [docs/decisions/](docs/decisions/): кратки обяснения на ключовите решения
- [CONTRIBUTING.md](CONTRIBUTING.md): как се допринася

## Трети страни

- **TripoSR** (MIT): кодът е вграден от [VAST-AI-Research/TripoSR](https://github.com/VAST-AI-Research/TripoSR), виж `engine/src/photo3d_engine/engines/triposr_vendor/NOTICE.md`. Теглата се свалят от Hugging Face (`stabilityai/TripoSR`) при първо пускане.
- **rembg** (MIT): маха фона на снимката.
- Библиотеки: PyTorch (BSD и Apache-2.0), transformers (Apache-2.0), trimesh (MIT), manifold3d (Apache-2.0), scikit-image (BSD-3-Clause).

Моделите, които правиш, са твои. Внимавай с авторските права, когато снимаш чужди фигури или персонажи.

## Лиценз

[MIT](LICENSE), Copyright (c) 2026 Sarkis Demirdjian.
