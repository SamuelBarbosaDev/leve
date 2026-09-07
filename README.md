# Leve

Comprima imagens e vídeos sem enviar nada para nenhum servidor. Tudo roda no
próprio dispositivo — no navegador, ou no computador via o app desktop.

O projeto tem dois produtos, no mesmo repositório:

| | [App Web](#app-web) | [App Desktop](desktop/README.md) |
|---|---|---|
| Público | Qualquer visitante | Uso interno do escritório |
| Onde roda | Navegador (client-side) | Windows e Linux, instalado |
| Compressão de vídeo | FFmpeg via WebAssembly (software) | FFmpeg nativo, com aceleração de hardware |
| Caso de uso | Comprimir imagens/vídeos avulsos, com privacidade | Comprimir vídeo rápido para caber no limite de upload da Shopee |

---

## App Web

Site estático, sem build step — HTML/CSS/JS puro, sem framework, sem
bundler. Abrir [index.html](index.html) já é o suficiente para rodar
localmente (ou servir a pasta com qualquer servidor estático).

### Funcionalidades

- **Compressão de imagem** (JPEG, PNG, WebP, GIF, BMP): qualidade ajustável,
  conversão de formato (WebP/JPEG/PNG), redimensionamento por tamanho máximo.
  Roda inteiramente via `Canvas`/`createImageBitmap` do navegador — sem
  WebAssembly, sem dependência externa.
- **Compressão de vídeo** (MP4, MOV, WebM, MKV): três presets de qualidade
  (Alta/Média/Arquivo pequeno) e redimensionamento por resolução (1080p/720p/
  480p/original). Usa [`@ffmpeg/ffmpeg`](https://github.com/ffmpegwasm/ffmpeg.wasm)
  (FFmpeg compilado para WebAssembly), carregado sob demanda via CDN e
  executado num Web Worker.
- **Download em lote**: ao comprimir 2 ou mais arquivos, aparece um botão
  "Baixar tudo (.zip)" que empacota todos os resultados num único `.zip`
  (via [JSZip](https://stuk.github.io/jszip/), também carregado via CDN).
- **Arrastar e soltar** ou seleção manual de arquivos, múltiplos por vez.
- 100% client-side: nenhum arquivo sai do navegador do usuário em nenhum
  momento.

### Estrutura

```text
index.html              Página única do app web
css/styles.css          Estilos (tema claro/escuro automático)
js/app.js               Orquestração da UI (cards, drag & drop, estado)
js/imageCompressor.js   Compressão de imagem via Canvas API
js/videoCompressor.js   Compressão de vídeo via ffmpeg.wasm
js/zipDownloader.js     Empacotamento em .zip (JSZip)
js/vendor/ffmpeg/       Worker do ffmpeg.wasm vendorizado localmente
assets/                 Ícones e favicon
```

### Rodando localmente

Não precisa de `npm install` nem build — é só servir os arquivos estáticos:

```bash
python3 -m http.server 8000
# ou: npx serve
```

E abrir `http://localhost:8000`.

### Limitações conhecidas

A compressão de vídeo roda inteiramente por software dentro do WebAssembly
(sem acesso a GPU/aceleração de hardware do navegador), então é
significativamente mais lenta que compressão nativa — para uso pesado de
vídeo, veja o [app desktop](desktop/README.md).

---

## App Desktop

Ferramenta interna (não distribuída publicamente) para comprimir vídeo
usando o FFmpeg nativo do computador, com aceleração de hardware real
(NVENC/QuickSync/AMF/VA-API) — pensada para quem sobe vídeo em plataformas
com limite de tamanho (ex.: Shopee) e precisa de velocidade que o navegador
não entrega.

Documentação completa, arquitetura, requisitos de build e solução de
problemas: **[desktop/README.md](desktop/README.md)**.

---

## Privacidade

Em ambos os produtos, os arquivos nunca são enviados a um servidor. O app
web faz tudo no navegador; o app desktop processa localmente no computador
onde está instalado.

## Licença

Sem licença definida — projeto interno.
