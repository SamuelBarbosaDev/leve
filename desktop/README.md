# Leve Desktop

App desktop interno (Windows + Linux) para comprimir vídeo usando o FFmpeg
nativo do computador, com aceleração de hardware (NVENC/QuickSync/AMF/VA-API)
quando disponível. Feito para quem sobe vídeo na Shopee e esbarra no limite
de tamanho da plataforma — o modo padrão comprime para um tamanho-alvo em MB
em vez de só uma predefinição de qualidade.

> Não é vendido nem distribuído publicamente — uso interno do escritório.

## Índice

- [Como funciona](#como-funciona)
- [Requisitos](#requisitos)
- [Desenvolvimento](#desenvolvimento)
- [Gerando um build](#gerando-um-build)
- [Configuração](#configuração)
- [Solução de problemas](#solução-de-problemas)
- [Estrutura do projeto](#estrutura-do-projeto)

## Como funciona

- **UI**: HTML/CSS/JS puro, sem bundler — vive em [src/](src/) e é
  praticamente a mesma interface do [site](../index.html), adaptada ao
  contexto nativo (sem "baixar", os arquivos são salvos direto no disco).
- **Motor**: Rust + [Tauri v2](https://tauri.app), em [src-tauri/](src-tauri/).
- **Compressão**: o Rust chama um binário real de `ffmpeg`/`ffprobe`
  (não é o ffmpeg.wasm do site) empacotado como *sidecar* do Tauri.

### Detecção de encoder de hardware

Ao iniciar, o app testa — de verdade, com uma codificação de 1 frame — qual
encoder funciona nesta máquina, na ordem:

- **Windows**: `h264_nvenc` → `h264_qsv` → `h264_amf` → `libx264` (CPU)
- **Linux**: `h264_nvenc` → `h264_vaapi` → `libx264` (CPU)

Isso importa porque um encoder pode aparecer disponível em `ffmpeg -encoders`
e mesmo assim falhar em tempo real (driver desatualizado, sem GPU compatível
etc.) — só confiar na lista do FFmpeg não é suficiente. A lógica está em
[`src-tauri/src/ffmpeg.rs`](src-tauri/src/ffmpeg.rs), função
`detect_best_encoder`.

### Modos de compressão

Cada vídeo escolhe um dos dois modos (mutuamente exclusivos — nunca somados):

- **Tamanho alvo** (padrão): você define um limite em MB e o app calcula o
  bitrate necessário a partir da duração do vídeo (com ~2% de margem para o
  container). Pensado para caber em limites de upload como o da Shopee.
- **Qualidade**: presets Alta/Média/Baixa via CRF (ou o equivalente de cada
  encoder de hardware — `-cq` no NVENC, `-global_quality` no QSV, etc).

Nos dois modos, dá pra também redimensionar (Original/1080p/720p/480p).

## Requisitos

| | Windows | Linux |
|---|---|---|
| Para **usar** o app já instalado | Nada além do próprio instalador | Nada além do pacote (`.deb`/`.AppImage`) |
| Para **compilar** | Rust + [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022) (WebView2 já vem com Windows 10/11 atualizado) | Rust + Node + bibliotecas de sistema (abaixo) |

Bibliotecas de sistema para compilar no Linux (Ubuntu/Debian):

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libdbus-1-dev \
  libssl-dev \
  libxdo-dev \
  patchelf \
  build-essential
```

## Desenvolvimento

```bash
cd desktop
node scripts/fetch-ffmpeg.mjs                          # baixa ffmpeg/ffprobe para src-tauri/binaries/
cargo install tauri-cli --locked --version "^2.0.0"     # só na primeira vez
cargo tauri dev
```

`cargo tauri dev` recompila só o que mudou e serve o frontend
(`src/`) direto do disco — editar HTML/CSS/JS e apertar salvar já reflete na
próxima janela, sem precisar rebuildar o Rust.

Rodar os testes unitários (cálculo de bitrate, parsing de progresso do
FFmpeg, montagem de argumentos):

```bash
cargo test
```

## Gerando um build

### Windows (.exe)

Ninguém no escritório usa Linux além de quem mantém o projeto, então o
`.exe` para o time precisa vir do Windows ou da CI — cross-compilar Windows
a partir do Linux não é confiável o suficiente.

**Via GitHub Actions (recomendado, não precisa de máquina Windows):** dar
push numa tag `desktop-vN` builda Windows e Linux em paralelo e publica um
**Release rascunho** com os instaladores já anexados — link permanente,
diferente de um artifact do Actions (que expira em 90 dias).

```bash
git tag desktop-v4
git push origin desktop-v4
```

Depois, entrar em `Releases` no GitHub, conferir os arquivos e clicar em
"Publish release" quando quiser liberar pro time.

Disparar manualmente pela aba **Actions → "Build Leve Desktop" → Run
workflow** (sem criar tag) também builda, mas fica só como artifact
temporário — útil pra testar sem gerar um Release a cada tentativa.

**Alternativa manual**: alguém com Windows roda os mesmos comandos da seção
[Desenvolvimento](#desenvolvimento), trocando `cargo tauri dev` por
`cargo tauri build`. Não precisa instalar nada de sistema além do Visual
Studio Build Tools.

### Linux

```bash
cd desktop
cargo tauri build
```

Gera `.AppImage` e `.deb` em
`src-tauri/target/release/bundle/{appimage,deb}/`.

### Tamanho do instalador

O FFmpeg estático "full" (build GPL da [BtbN](https://github.com/BtbN/FFmpeg-Builds))
usado como sidecar tem ~140 MB *cada* (ffmpeg + ffprobe), então o instalador
final fica em torno de **280–300 MB** — bem mais que os poucos MB de um app
Tauri "puro", mas ainda uma fração do que um Electron equivalente pesaria.
Se isso virar problema, uma build customizada do FFmpeg só com os codecs que
a Shopee aceita (H.264/AAC) cortaria bastante esse tamanho.

### Licenciamento do FFmpeg

O binário baixado é a build "gpl" da BtbN (inclui libx264). Aceitável porque
o app não é distribuído/vendido — uso interno. Se isso mudar (vender,
distribuir fora da empresa), trocar para uma build LGPL antes.

## Configuração

| O que mexer | Onde |
|---|---|
| Valor padrão do campo "Tamanho alvo" e opções de resolução | [src/js/app.js](src/js/app.js) |
| Cálculo de bitrate e flags de rate-control por encoder | [src-tauri/src/ffmpeg.rs](src-tauri/src/ffmpeg.rs) |
| Comandos expostos à UI (comprimir, escolher pasta, abrir pasta) | [src-tauri/src/commands.rs](src-tauri/src/commands.rs) |
| Ícones do app | [src-tauri/icons/](src-tauri/icons/) |
| Bundle/targets/permissões | [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json), [src-tauri/capabilities/](src-tauri/capabilities/) |

## Solução de problemas

### Seletor de arquivo/pasta não abre nada ao clicar (Linux)

Sintoma: clicar em "Arraste vídeos aqui" ou "Escolher pasta..." não faz
nada, sem erro visível.

Causa confirmada num caso real: o `xdg-desktop-portal-gnome` da máquina
falha ao delegar a chamada `org.freedesktop.portal.FileChooser`
(`Message recipient disconnected from message bus without replying`) — um
bug no portal do GNOME, não no app. Reproduzível isoladamente com:

```bash
gdbus call --session --dest org.freedesktop.portal.Desktop \
  --object-path /org/freedesktop/portal/desktop \
  --method org.freedesktop.portal.FileChooser.OpenFile "" "teste" "{}"
```

Se isso já falhar sem o app aberto, é confirmadamente um problema do
ambiente, não do Leve Desktop. **Correção já aplicada** no projeto: o `rfd`
(crate usada pelos diálogos) está configurado para usar o GTK3 nativo
diretamente (`default-features = false, features = ["gtk3"]` em
[Cargo.toml](src-tauri/Cargo.toml)), contornando o portal por completo — se
você vir esse sintoma numa build antiga, atualize.

### App detecta só "CPU (software)" com uma GPU NVIDIA presente

O FFmpeg baixado é uma build recente cujo NVENC exige um driver NVIDIA
mínimo relativamente novo (`>= 610.00`). Se o driver instalado for mais
antigo, o probe de encoder falha o teste real (mesmo o encoder aparecendo
disponível) e cai pra CPU corretamente. Verifique a versão instalada:

```bash
nvidia-smi   # olhe "Driver Version"
```

No Ubuntu, atualizar costuma ser um `apt install nvidia-driver-<versão>-open`
(confira com `ubuntu-drivers devices` quais estão disponíveis) seguido de
reboot — o módulo de kernel só troca depois de reiniciar.

### VA-API falha ao inicializar numa GPU AMD/Intel integrada

Precisa do driver VA-API correspondente instalado (`mesa-va-drivers` ou
equivalente, o nome do pacote varia por distro/versão). Sem ele, o probe
falha o teste real e cai pra `libx264` (CPU) — comportamento esperado, não
trava nada.

## Estrutura do projeto

```text
desktop/
├── scripts/
│   └── fetch-ffmpeg.mjs      Baixa ffmpeg/ffprobe (BtbN) para src-tauri/binaries/
├── src/                      Frontend (HTML/CSS/JS puro, sem bundler)
│   ├── index.html
│   ├── css/styles.css
│   └── js/app.js
└── src-tauri/                Backend Rust + config do Tauri
    ├── src/
    │   ├── main.rs           Registro de plugins e comandos
    │   ├── commands.rs       Comandos expostos à UI (compress_video, pick_*, reveal_in_folder)
    │   └── ffmpeg.rs         Detecção de encoder, cálculo de bitrate, montagem de args
    ├── capabilities/         Permissões da janela (ACL do Tauri v2)
    ├── icons/
    ├── binaries/             ffmpeg/ffprobe baixados (gitignored, gerado pelo fetch script)
    └── tauri.conf.json
```
