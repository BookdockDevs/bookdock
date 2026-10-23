<div align="center">
  <h1>Bookdock · 书坞</h1>
  <p>自托管的在线电子书库。</p>
  <p>中文 · <a href="./README.en.md">English</a></p>
  <p>
    <a href="https://github.com/BookdockDevs/bookdock/releases"><img src="https://img.shields.io/github/v/release/BookdockDevs/bookdock?style=flat-square&amp;label=release" alt="最新版本"></a>
    <a href="https://hub.docker.com/r/loofffff/bookdock"><img src="https://img.shields.io/badge/Docker-loofffff%2Fbookdock-2496ED?style=flat-square&amp;logo=docker&amp;logoColor=white" alt="Docker 镜像"></a>
  </p>
</div>

整理 EPUB 和 TXT 电子书，在浏览器中阅读，保存划线、想法和阅读进度。你可以维护自己的个人书库，也可以创建共享书库，与其他读者分享书籍、交流阅读感受。

## 主要功能

| 功能 | 说明 |
| :--- | :--- |
| **整理藏书** | 上传电子书，通过书架、分类和标签整理，搜索查找书籍。 |
| **在线阅读** | 支持 EPUB 和 TXT，可调整字体、主题和阅读布局，使用目录与书签定位内容。 |
| **记录阅读** | 保存划线和想法，记录阅读进度与时长，查看阅读统计。 |
| **分享交流** | 创建共享书库，管理成员与访问权限，发表书评，参与评论和讨论。 |
| **辅助阅读** | 支持语音朗读和 AI 阅读助手，可在设置中配置相应服务。 |

## 快速部署

**1. 保存配置**

安装 Docker 后，将以下内容保存为 `docker-compose.yml`：

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

**2. 启动服务**

在该文件所在目录运行：

```bash
docker compose up -d
```

**3. 开始使用**

打开 [http://localhost:18423](http://localhost:18423)，按页面提示创建书库所有者账户。远程部署时，将 `localhost` 替换为服务器地址。所有者可以在设置中开启注册或游客访问。

> [!NOTE]
> 默认情况下，数据保存在 Compose 文件同级的 `data/` 目录。备份时先停止容器，再完整复制该目录，包括隐藏文件；如果配置了远端存储，还需单独备份远端书籍文件。
