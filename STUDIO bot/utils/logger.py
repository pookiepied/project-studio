import logging
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional

class StructuredLogger:
    
    def __init__(self, name: str = "studio_bot"):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)
        
        handler = logging.StreamHandler()
        handler.setLevel(logging.INFO)
        
        formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        handler.setFormatter(formatter)
        
        if not self.logger.handlers:
            self.logger.addHandler(handler)
    
    def _create_log_entry(
        self,
        level: str,
        message: str,
        user_id: Optional[str] = None,
        channel_id: Optional[str] = None,
        guild_id: Optional[str] = None,
        request_type: Optional[str] = None,
        model: Optional[str] = None,
        latency_ms: Optional[float] = None,
        error_code: Optional[str] = None,
        extra: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": level,
            "message": message
        }
        
        if user_id:
            entry["user_id"] = user_id
        if channel_id:
            entry["channel_id"] = channel_id
        if guild_id:
            entry["guild_id"] = guild_id
        if request_type:
            entry["request_type"] = request_type
        if model:
            entry["model"] = model
        if latency_ms is not None:
            entry["latency_ms"] = latency_ms
        if error_code:
            entry["error_code"] = error_code
        if extra:
            entry.update(extra)
        
        return entry
    
    def info(self, message: str, **kwargs):
        entry = self._create_log_entry("INFO", message, **kwargs)
        self.logger.info(json.dumps(entry))
    
    def warning(self, message: str, **kwargs):
        entry = self._create_log_entry("WARNING", message, **kwargs)
        self.logger.warning(json.dumps(entry))
    
    def error(self, message: str, **kwargs):
        entry = self._create_log_entry("ERROR", message, **kwargs)
        self.logger.error(json.dumps(entry))
    
    def debug(self, message: str, **kwargs):
        entry = self._create_log_entry("DEBUG", message, **kwargs)
        self.logger.debug(json.dumps(entry))

logger = StructuredLogger()
