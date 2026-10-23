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

## Features

| Feature | Description |
| :--- | :--- |
| **Organize your books** | Upload e-books, arrange them with shelves, categories, and tags, and search your collection. |
| **Read in your browser** | Read EPUB and TXT books with adjustable fonts, themes, and layouts. Navigate with the table of contents and bookmarks. |
| **Keep a reading record** | Save highlights and notes, track progress and reading time, and view reading statistics. |
| **Share and discuss** | Create shared libraries, manage membership and access, write reviews, and join comments and discussions. |
| **Reading tools** | Use text-to-speech and an AI reading assistant by configuring the corresponding services in Settings. |

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

> [!NOTE]
> By default, data is stored in the `data/` directory beside the Compose file. To back it up, stop the container and copy the entire directory, including hidden files. If you configure remote storage, back up the remote book files separately as well.
