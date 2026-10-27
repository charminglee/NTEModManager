# -*- coding: utf-8 -*-
# =================================================
#   Author: Nuoyan <https://github.com/charminglee>
#   Email : 1279735247@qq.com
#   Date  : 2026-10-28
# =================================================


import json
import logging
import sys
from datetime import datetime, timezone


class ServiceLogFormatter(logging.Formatter):
    """
    将视觉识别服务日志编码为独立的 JSON Lines 消息。
    """

    def format(self, record: logging.LogRecord) -> str:
        """
        保留日志级别、产生时间、来源和完整异常，确保每条消息只占一行。
        """
        # 使用管理器支持的四种级别，CRITICAL 归入错误。
        if record.levelno >= logging.ERROR:
            level = "error"
        elif record.levelno >= logging.WARNING:
            level = "warning"
        elif record.levelno >= logging.INFO:
            level = "info"
        else:
            level = "debug"

        # 异常堆栈作为独立字段传输，换行由 JSON 转义。
        payload = {
            'type': "log",
            'version': 1,
            'timestamp': datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            'level': level,
            'logger': record.name,
            'message': record.getMessage(),
        }
        if record.exc_info:
            payload['exception'] = self.formatException(record.exc_info)
        if record.stack_info:
            payload['stack'] = self.formatStack(record.stack_info)
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(structured: bool = False) -> None:
    """
    服务模式通过 stderr 发送结构化日志，独立 HTTP 模式保持可读文本。
    """
    # Windows 管道统一使用 UTF-8，保留无法编码字符的转义表示。
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            try:
                stream.reconfigure(encoding="utf-8", errors="backslashreplace")
            except (OSError, ValueError):
                pass

    # 日志只写入 stderr，避免混入 stdout 的识别响应。
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        ServiceLogFormatter() if structured else logging.Formatter("%(name)s: %(message)s")
    )
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
