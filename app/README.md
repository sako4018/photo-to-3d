# photo-to-3d: приложението с прозорец (Фаза 2)

Electron + React + TypeScript (electron-vite). Дърпаш снимка в прозореца, гледаш прогреса, въртиш готовия модел в 3D, сменяш височина и плоча и натискаш „Save STL“ или „Open in Bambu Studio“. Няма терминал за потребителя. Текстът в приложението е на английски (избор от плана), документацията е на български.

Подробният план и какво е проверено: [docs/phase-2-app.md](../docs/phase-2-app.md).

## Как се пуска (разработка, Mac)

```bash
cd "$HOME/Desktop/Developer/personal projects/photo-to-3d/app"
npm install
npm run dev
```

Приложението само пуска Python engine-а (`uv run` в `../engine`), чете порта от първия му ред и го спира при затваряне. Ако `npm install` не свали Electron (скриптовете за инсталиране може да са блокирани), пусни: `node node_modules/electron/install.js`.

### Променливи за разработка

| Променлива | Какво прави |
|---|---|
| `PHOTO3D_ENGINE_ID=dummy` | малкият тестов engine вместо TripoSG (без 8 GB модел) |
| `PHOTO3D_DUMMY_SECONDS=12` | колко дълго „мисли“ тестовият engine (за да се види прогресът) |
| `PHOTO3D_DATA_DIR=/папка` | къде са проектите и моделите (по подразбиране папката на приложението) |
| `PHOTO3D_ENGINE='{"host":"127.0.0.1","port":59782,"token":"dev"}'` | не пуска engine, а се връзва към вече работещ |
| `PHOTO3D_UV=/път/до/uv` | ако `uv` не е на обичайното място |

Папка за профил на приложението (настройки) може да се смени с `-- --user-data-dir=/папка`, напр. за пробни пускания: `npx electron-vite dev -- --user-data-dir=/tmp/p3d`.

## Какво има в приложението

- **Начало:** поле за снимка (или „Choose a photo…“), 3 съвета; снимка може да се пусне навсякъде в прозореца. Приема JPG, PNG, HEIC, WebP до 50 MB.
- **Първо пускане:** проверка на компютъра и сваляне на модела с Pause/Resume (показва се само ако моделът липсва).
- **Прогрес:** стъпки, лента, оставащо време, Cancel; втора снимка влиза на опашка.
- **Работно място:** 3D изглед и панел вдясно (Printability, Size, Placement, Detail); промените по височина, плоча и завъртане не пускат нов AI, а само подготовката за печат (около 1 s за истински модел).
- **Проекти:** списък отляво, двоен клик преименува, десен клик: Rename, Show in Finder, Delete.
- **Настройки** (⌘,): слайсър, височина и детайл по подразбиране, къде е моделът, папка с проекти, About.
- **Клавиши:** ⌘N нова снимка, ⌘S Save STL, ⌘, настройки.

## Команди

```bash
npm run typecheck   # проверка на типовете
npm run lint        # ESLint
npm test            # Vitest (логика, менажер на engine-а, слайсъри, настройки)
npm run build       # build в out/
npm run test:e2e    # Playwright: целият поток с тестовия engine (първо npm run build)
```

Тестовете със знак „skip“ се пускат само срещу работещ engine: `PHOTO3D_ENGINE='{...}' npm test`.

## Структура

- `src/main`: главен процес. `engine-manager.ts` пуска и следи engine-а (рестарт веднъж след срив, чисто спиране), `engine-ipc.ts` е мостът към него (токенът не излиза от main процеса), `files.ts` Save STL / слайсър / Show in Finder, `settings.ts`, `windows.ts`, `menu.ts`
- `src/preload`: тесният API `window.api`
- `src/shared/types.ts`: общи типове и имена на IPC канали
- `src/renderer/src`: React. `pages/` (Home, Progress, ProjectView, Workspace, Setup, SettingsWindow), `components/`, `lib/` (чиста логика с тестове), `store.ts` (Zustand), `api/engine-client.ts`
- `e2e/`: Playwright тестът
- `build/icon.png`: иконата

## Какво още не е направено

- Инсталатор, подпис и notarization (Фаза 5): досега приложението се пуска само от кода и намира engine-а в `../engine`.
- Windows: кодът е писан за двете системи, но е пробван само на Mac. Нужен е истински PC (по възможност с NVIDIA).
- Е2Е тестът още не е в CI (иска macOS машина с `uv` и engine-а).
