# Leve Desktop

App desktop interno (Windows + Linux) para comprimir vídeo usando o FFmpeg
nativo do computador, com aceleração de hardware (NVENC/QuickSync/AMF/VA-API)
quando disponível. Feito para quem sobe vídeo na Shopee e esbarra no limite de
tamanho da plataforma — o modo padrão comprime para um tamanho-alvo em MB em
vez de só uma predefinição de qualidade.

Não é vendido nem distribuído publicamente — uso interno do escritório.

## Como funciona

- UI: HTML/CSS/JS puro (sem bundler), igual em espírito ao site
  [leve](../index.html) — vive em [src/](src/).
- Motor: Rust + [Tauri v2](https://tauri.app), em [src-tauri/](src-tauri/).
- Compressão: o Rust chama um binário real de `ffmpeg`/`ffprobe` (não é
  ffmpeg.wasm) empacotado como "sidecar" do Tauri. Ao abrir o app, ele testa
  (de verdade, com uma codificação de 1 frame) qual encoder de hardware
  funciona nesta máquina — `h264_nvenc` → `h264_qsv` → `h264_amf` no Windows,
  `h264_nvenc` → `h264_vaapi` no Linux — e cai para `libx264` (CPU) se nenhum
  funcionar. Isso importa porque um encoder pode aparecer disponível no
  `ffmpeg -encoders` e mesmo assim falhar em tempo real por driver
  desatualizado ou falta de GPU compatível.
- Dois modos de compressão por vídeo:
  - **Tamanho alvo (padrão)**: você diz "até 30 MB" e o app calcula o bitrate
    necessário pela duração do vídeo (com ~2% de margem para o container).
  - **Qualidade**: os mesmos presets Alta/Média/Baixa do site, via CRF (ou o
    equivalente de cada encoder de hardware).
- Sem upload de arquivo pela UI: os arquivos comprimidos são salvos direto no
  disco (pasta escolhida ou, por padrão, a mesma pasta do vídeo original) —
  não existe a etapa de "baixar" do navegador porque o app já tem acesso real
  ao sistema de arquivos.

## O que foi validado e o que não

Rodei o binário FFmpeg real (baixado do mesmo lugar que o app vai usar) neste
Linux e confirmei, com testes de verdade:
- a lógica de probe de encoder cai corretamente para `libx264` quando NVENC
  tem driver desatualizado e VA-API falha ao inicializar — que é exatamente o
  que acontece nesta máquina agora;
- o parsing do progresso (`-progress pipe:1`, campo `out_time=`) bate com o
  formato real do FFmpeg;
- o modo "tamanho alvo" gera um arquivo dentro do limite pedido;
- redimensionamento (`-vf scale=-2:480`) e vídeo sem áudio funcionam sem erro.

O que **não** deu para validar aqui: a compilação da casca do Tauri em si
(janela nativa), porque faltam bibliotecas de sistema (WebKitGTK etc.) e este
ambiente não tem acesso a `sudo` interativo para instalá-las. Ou seja: a
"cola" entre o Rust e o Tauri (spawn do sidecar, eventos de progresso) foi
escrita com cuidado seguindo a API documentada do Tauri v2, mas o primeiro
build de verdade é que vai confirmar se compila sem ajuste. Isso é normal
para este tipo de projeto — só peço que rode o primeiro build e me avise se
aparecer erro de compilação para eu corrigir.

## Build local no Linux (você)

Instale as dependências de sistema uma vez (precisa de sudo — rode você
mesmo, isso eu não consigo fazer por aqui):

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

Depois:

```bash
cd desktop
node scripts/fetch-ffmpeg.mjs        # baixa ffmpeg/ffprobe para src-tauri/binaries/
cargo install tauri-cli --locked --version "^2.0.0"   # só na primeira vez
cargo tauri dev                      # roda em modo desenvolvimento
cargo tauri build                    # gera o pacote final (.AppImage/.deb)
```

## Gerar o instalador Windows (.exe)

Ninguém no escritório usa Linux além de você, então o `.exe` para o time
precisa ser gerado no Windows ou via CI — cross-compilar Windows a partir do
Linux não é confiável o suficiente para isso.

**Opção recomendada: GitHub Actions** (não precisa de máquina Windows).
Já existe o workflow em
[.github/workflows/desktop-build.yml](../.github/workflows/desktop-build.yml):
dá um `git push` de uma tag `desktop-v1` e ele builda Windows e Linux em
paralelo e publica um **Release** (como rascunho — "Publish release" na
página do Release quando quiser liberar) com o `.exe` e o `.AppImage`/`.deb`
já anexados. Isso dá um link permanente pra galera do escritório baixar,
em vez de um artifact do Actions que expira em 90 dias.

```bash
git tag desktop-v1
git push origin desktop-v1
```

Disparar pela aba Actions → "Build Leve Desktop" → Run workflow (sem tag)
também funciona, mas nesse caso fica só como artifact temporário do run —
útil pra testar rápido sem criar um Release novo a cada tentativa.

Alternativa: pedir pra alguém com Windows rodar os mesmos três comandos do
build local (Rust + Node + `fetch-ffmpeg.mjs` + `cargo tauri build`), sem
precisar instalar nada de sistema além do Visual Studio Build Tools (o
WebView2 runtime já vem com o Windows 10/11 atualizado).

## Tamanho do instalador

O FFmpeg estático "full" (BtbN, build GPL) usado como sidecar tem ~140 MB
*cada* (ffmpeg + ffprobe), então o instalador final fica em torno de
**280–300 MB** — bem mais que os poucos MB que um app Tauri "puro" teria, mas
ainda assim uma fração do que um Electron equivalente pesaria. Se isso virar
problema, dá pra compilar uma build customizada do FFmpeg só com os codecs
que a Shopee realmente aceita (H.264/AAC) e cortar bastante esse tamanho —
não fiz isso agora para não gastar tempo otimizando algo que talvez nem
importe no uso real.

## Licenciamento do FFmpeg

O binário baixado é a build "gpl" da BtbN (inclui libx264). Isso é aceitável
porque o app **não é distribuído/vendido** — é uso interno da empresa. Se um
dia isso mudar (vender, distribuir fora da empresa), revisar para uma build
LGPL antes.

## Onde mexer

- Limite padrão de 30 MB e opções de resolução: [src/js/app.js](src/js/app.js).
- Cálculo de bitrate / flags de cada encoder: [src-tauri/src/ffmpeg.rs](src-tauri/src/ffmpeg.rs).
- Comandos expostos à UI (compress, escolher pasta, abrir pasta): [src-tauri/src/commands.rs](src-tauri/src/commands.rs).
