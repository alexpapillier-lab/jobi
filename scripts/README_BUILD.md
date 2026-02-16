# Build testovací verze (Jobi + JobiDocs)

## Prerekvizity

- **Node.js** a `npm install` v kořeni projektu i v `jobidocs/`
- **Rust:** Pokud ještě nemáš výchozí toolchain, spusť jednou:
  ```bash
  rustup default stable
  ```

## Rychlý test release (jedna architektura)

V kořeni projektu:

```bash
bash scripts/build-test-release.sh
```

Výstup: **jobi-test-release.zip** (obsahuje `jobi.app` + `JobiDocs.app` pro aktuální Mac).

## Plný release (universal macOS + zip)

```bash
bash scripts/build-jobi-and-jobidocs.sh
```

- Jobi se zbuildí pro Apple Silicon i Intel a slije do jednoho .app (universal).
- Výstup: **jobi-export.zip**.

## Kde co je po buildu

| Build        | Jobi .app | JobiDocs | Zip |
|-------------|-----------|----------|-----|
| test-release | `src-tauri/target/release/bundle/macos/jobi.app` | `jobidocs/release/.../JobiDocs.app` | `jobi-test-release.zip` |
| full (universal) | `src-tauri/target/release/bundle/macos/jobi.app` | stejně | `jobi-export.zip` |

## První spuštění na Macu (nepodepsaný build)

Viz **docs/INSTALL_TEST.md** – uživatel musí jednou zvolit pravý klik → Otevřít (nebo Předvolby → Zabezpečení).
