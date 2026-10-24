"""Toonflow 监控采集脚本（ComfyUI 扩展）。

安装：把本文件复制到 ComfyUI 的 custom_nodes 目录（文件名必须是 toonflow_metrics.py），
重启 ComfyUI 后访问 http://<主机>:<端口>/toonflow/metrics 即可看到数据。

依赖（可选）：
  pip install psutil pynvml
缺依赖时对应字段为 null，不会影响 ComfyUI 本身。
"""

import logging
import platform
import time

logger = logging.getLogger("toonflow.metrics")

try:
    from aiohttp import web
    from server import PromptServer
except Exception as exc:  # 不在 ComfyUI 进程里运行
    web = None
    PromptServer = None
    logger.warning("[toonflow] 无法导入 ComfyUI 模块，监控路由未注册：%s", exc)

try:
    import psutil
except Exception:
    psutil = None

if psutil is not None:
    # 第一次调用没有采样基线会返回 0，先预热一次。
    psutil.cpu_percent(interval=None)

try:
    import pynvml

    pynvml.nvmlInit()
except Exception:
    pynvml = None

try:
    # ComfyUI 自身版本，供状态栏显示。
    from comfyui_version import __version__ as comfy_version
except Exception:
    comfy_version = None


def _cpu():
    if psutil is None:
        return None
    try:
        percent = psutil.cpu_percent(interval=None)
        cores = psutil.cpu_count(logical=True)
    except Exception:
        return None
    freq_mhz = None
    try:
        # macOS 等平台不支持查询频率，单独兜住，不影响使用率。
        freq = psutil.cpu_freq()
        freq_mhz = round(freq.current) if freq else None
    except Exception:
        pass
    return {"percent": percent, "cores": cores, "freqMhz": freq_mhz}


def _ram():
    if psutil is None:
        return None
    try:
        memory = psutil.virtual_memory()
        return {"total": memory.total, "used": memory.total - memory.available, "percent": memory.percent}
    except Exception:
        return None


def _gpus():
    if pynvml is None:
        return []
    devices = []
    try:
        count = pynvml.nvmlDeviceGetCount()
    except Exception:
        return []
    for index in range(count):
        try:
            handle = pynvml.nvmlDeviceGetHandleByIndex(index)
            name = pynvml.nvmlDeviceGetName(handle)
            if isinstance(name, bytes):
                name = name.decode("utf-8", "replace")
            memory = pynvml.nvmlDeviceGetMemoryInfo(handle)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            temperature = None
            power = None
            try:
                temperature = pynvml.nvmlDeviceGetTemperature(handle, pynvml.NVML_TEMPERATURE_GPU)
            except Exception:
                pass
            try:
                power = round(pynvml.nvmlDeviceGetPowerUsage(handle) / 1000, 1)
            except Exception:
                pass
            devices.append({
                "index": index,
                "name": name,
                "util": util.gpu,
                "memoryTotal": memory.total,
                "memoryUsed": memory.used,
                "temperature": temperature,
                "power": power,
            })
        except Exception:
            continue
    return devices


def _queue():
    if PromptServer is None:
        return None
    queue = PromptServer.instance.prompt_queue
    try:
        # 新版 ComfyUI 提供 volatile 版本，老版本回退到非 volatile。
        if hasattr(queue, "get_current_queue_volatile"):
            running, pending = queue.get_current_queue_volatile()
        else:
            running, pending = queue.get_current_queue()
        return {"running": len(running), "pending": len(pending)}
    except Exception:
        return None


def collect():
    missing = []
    if psutil is None:
        missing.append("psutil")
    if pynvml is None:
        missing.append("pynvml")
    return {
        "platform": platform.platform(),
        "version": comfy_version,
        "ts": int(time.time() * 1000),
        "cpu": _cpu(),
        "ram": _ram(),
        "gpus": _gpus(),
        "queue": _queue(),
        "missing": missing,
    }


if PromptServer is not None and web is not None and getattr(PromptServer, "instance", None) is not None:
    @PromptServer.instance.routes.get("/toonflow/metrics")
    async def toonflow_metrics(request):  # noqa: ANN001
        return web.json_response(collect())

    logger.info("[toonflow] 已注册监控路由 /toonflow/metrics")
else:
    logger.warning("[toonflow] 未找到 PromptServer 实例，监控路由未注册（确认本文件放在 ComfyUI 的 custom_nodes 目录并重启）")
