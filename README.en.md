<div align="center">
  <h1>Bookdock</h1>
  <p>A self-hosted e-book library for reading in your browser.</p>
  <p><a href="./README.md">中文</a> · English</p>
  <p>
    <a href="https://github.com/BookdockDevs/bookdock/releases"><img src="https://img.shields.io/github/v/release/BookdockDevs/bookdock?style=flat-square&amp;label=release" alt="Latest release"></a>
    <a href="https://hub.docker.com/r/loofffff/bookdock"><img src="https://img.shields.io/badge/Docker-loofffff%2Fbookdock-2496ED?style=flat-square&amp;logo=docker&amp;logoColor=white" alt="Docker image"></a>
  </p>
</div>

Organize EPUB and TXT books, read them online, and keep your highlights, notes, and reading progress. Maintain a personal library or create shared libraries to share books and discuss what you read with others.

## Platforms

![Web](https://img.shields.io/badge/Web-4285F4?style=flat-square&logo=googlechrome&logoColor=white) ![Android](https://img.shields.io/badge/Android-3DDC84?style=flat-square&logo=android&logoColor=white) ![iOS](https://img.shields.io/badge/iOS-555555?style=flat-square&logo=apple&logoColor=white) ![Kindle](https://img.shields.io/badge/Kindle-555555?style=flat-square)

- **Web**: Use Bookdock in a browser on a computer, phone, or tablet.
- **Android / iOS**: Access your library with a reader that supports Legado book sources.
- **Kindle and other e-ink devices**: Use a lightweight reading interface designed for e-ink screens.

## Features

| Feature | Description |
| :--- | :--- |
| **Library management** | Upload EPUB and TXT books, organize them with shelves, categories, and tags, search your collection, and manage books in batches. |
| **Book metadata** | Search built-in or personally installed sources to update book information and covers. |
| **Reading** | Customize fonts, themes, layout, and page turns; use reading presets, navigate with the table of contents and bookmarks, search the full book, and convert between Simplified and Traditional Chinese. |
| **Fonts and media** | Use built-in fonts or upload your own, and play audio and video embedded in EPUB books. |
| **E-ink reading** | Use a lightweight bookshelf and paginated reader, adjust display and tap zones, and synchronize reading progress. |
| **Content editing** | Edit TXT and EPUB text and navigation, review changes before saving, and recover local drafts. |
| **Text and table-of-contents rules** | Apply global or per-book text replacements, make individual corrections, and use TXT table-of-contents rules; import and export rules. |
| **Reading records** | Save progress, highlights, notes, and ideas; track reading time and explore statistics and your archive. |
| **Excerpt sharing** | Create share cards for excerpts or ideas, customize templates and fonts, and copy or save the images. |
| **Sharing and discussion** | Create shared libraries, manage membership and access, share books, write reviews, and join discussions. |
| **External storage** | Connect WebDAV or S3-compatible storage to browse and import books; store book files remotely with a local cache. |
| **Import and export** | Import books from external storage, download books individually or in batches, and back up or export reading data. |
| **Reading tools** | Use text-to-speech, automatic reading, and an AI reading assistant, with related services configurable in Settings. |
| **Legado book source** | Generate a book source to browse, search, and read your library in readers that support it. |
| **Deployment and administration** | Self-host with Docker, manage accounts, registration, and guest access, and update from within the app. |

## Quick start

**1. Save the configuration**

With Docker installed, save the following as `docker-compose.yml`:

```yaml
services:
  bookdock:
    image: loofffff/bookdock:latest
    ports:
      - "18423:18423"
    volumes:
      - ./data:/data
    restart: unless-stopped
```

**2. Start Bookdock**

Run this command from the directory containing the file:

```bash
docker compose up -d
```

**3. Open your library**

Open [http://localhost:18423](http://localhost:18423) and follow the setup screen to create the owner account. For a remote deployment, replace `localhost` with your server address. The owner can enable registration or guest access in Settings.
