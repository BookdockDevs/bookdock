# Bookdock Product Context

Bookdock is a self-hosted e-book library and reader. This context records the product language used for user-facing feedback so the same event is not represented inconsistently across the library, reader, settings, and authentication flows.

## User Feedback

**Notification**:
A user-visible explanation of an operation or system state. A notification may be transient, inline, or attached to a longer-running task.
_Avoid_: treating every notification as a toast.

**Toast**:
A transient, global notification shown near the edge of the current page for a completed action or an immediately actionable problem.
_Avoid_: using a toast as the only status for page loading failures or long-running work.

**Inline error**:
A persistent error state rendered beside the page, panel, or field whose content failed to load or validate.
_Avoid_: hiding a recoverable page error in a disappearing toast.

## Books and TOC

**目录规则**：决定 TXT 正文如何识别卷、章、节并组织为阅读目录的用户预设。

**内置规则**：由 Bookdock 随产品提供、可被用户编辑或删除的规则；“内置”描述规则来源，不代表规则内容不可修改。

**自定义规则**：由用户新建的规则，不带产品内置来源标识。

**恢复默认**：补回缺失的内置规则，或将一组可恢复的内置配置还原为产品默认内容；除明确说明外，不影响用户自定义内容。

**自动分章**：系统根据启用的目录规则，从书籍正文选择最合适的预设；它不是用户固定选择。

**重分章**：用户明确切换目录规则后，重新生成本书目录；书籍正文不变，阅读位置可能因章节边界变化而需要重新定位。

**序章**：书中实际标为“序章”的章节，或目录标题之前尚未归属的前置内容；它不是每本书固定存在的章节。

**Task status**:
The persistent progress and final outcome of work that may outlive the initiating interaction, such as an upload or index build.
_Avoid_: representing ongoing progress with repeated toasts.
