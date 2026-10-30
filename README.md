<div align="center">
  <h1>Bookdock · 书坞</h1>
  <p>自托管的在线电子书库。</p>
  <p>中文 · <a href="./README.en.md">English</a></p>
  <p>
    <a href="https://github.com/BookdockDevs/bookdock/releases"><img src="https://img.shields.io/github/v/release/BookdockDevs/bookdock?style=flat-square&label=release" alt="最新版本"></a>
    <a href="https://hub.docker.com/r/loofffff/bookdock"><img src="https://img.shields.io/badge/Docker-loofffff%2Fbookdock-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker 镜像"></a>
  </p>
</div>

整理 EPUB 和 TXT 电子书，在浏览器中阅读，保存划线、想法和阅读进度。你可以维护自己的个人书库，也可以创建共享书库，与其他读者分享书籍、交流阅读感受。

## 支持平台

![Web](https://img.shields.io/badge/Web-4285F4?style=flat-square&logo=googlechrome&logoColor=white) ![Android](https://img.shields.io/badge/Android-3DDC84?style=flat-square&logo=android&logoColor=white) ![iOS](https://img.shields.io/badge/iOS-555555?style=flat-square&logo=apple&logoColor=white) ![Kindle](https://img.shields.io/badge/Kindle-555555?style=flat-square)

- **Web**：在电脑、手机和平板的浏览器中使用。
- **Android / iOS**：通过支持「阅读」书源的阅读器访问书库。
- **Kindle 等墨水屏设备**：使用专为墨水屏优化的轻量阅读界面。

## 主要功能


| 功能           | 说明                                                                                 |
| :------------- | :----------------------------------------------------------------------------------- |
| **书库管理**   | 上传 EPUB 和 TXT，通过书架、分类和标签整理藏书，搜索书籍并批量管理。                 |
| **书籍信息** | 从内置或个人安装的信息源搜索并更新书籍信息和封面。 |
| **阅读体验**   | 自定义字体、主题、排版和翻页方式，使用阅读预设、目录、书签、全书搜索和简繁转换。 |
| **字体与媒体** | 使用内置字体或上传自定义字体，播放 EPUB 中的音频和视频。 |
| **墨水屏阅读** | 使用轻量书架和分页阅读，调整显示及翻页区域，同步阅读进度。                           |
| **编辑书籍**   | 编辑 TXT 和 EPUB 正文与目录，保存前查看修改，并恢复本地草稿。                        |
| **文本与目录规则** | 使用全局或单书文本替换规则、单处修正和 TXT 目录规则；支持规则导入与导出。 |
| **阅读记录**   | 保存阅读进度、划线、笔记和想法，记录阅读时长，查看阅读统计和归档。                   |
| **书摘分享** | 将书摘或想法制作成分享卡片，自定义模板和字体，复制或保存图片。 |
| **共享与交流** | 创建共享书库，管理成员和访问权限，分享书籍、发表书评并参与讨论。                     |
| **外部存储**   | 连接 WebDAV 或 S3 兼容存储，浏览并导入书籍；支持将书籍文件存放在远端并使用本地缓存。 |
| **导入与导出** | 从外部存储导入书籍，下载或批量导出书籍，并备份或导出阅读数据。                       |
| **辅助阅读**   | 使用语音朗读、自动阅读和 AI 阅读助手；可在设置中配置相关服务。                       |
| **阅读书源** | 生成「阅读」书源，在支持书源的阅读器中浏览、搜索和阅读书库。 |
| **部署与管理** | 使用 Docker 自托管，管理账户、注册和游客访问，并在应用内更新。                       |

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
