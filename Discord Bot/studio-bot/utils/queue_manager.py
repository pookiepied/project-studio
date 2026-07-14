import asyncio
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Callable, Awaitable, List
from utils.logger import logger

class QueueManager:
    
    def __init__(
        self,
        max_concurrent: int = 3,
        timeout_seconds: int = 60,
        max_queue_size: int = 50
    ):
        if max_concurrent < 1:
            raise ValueError("max_concurrent must be at least 1")
        if timeout_seconds < 1:
            raise ValueError("timeout_seconds must be at least 1")
        if max_queue_size < 1:
            raise ValueError("max_queue_size must be at least 1")
        
        self.max_concurrent = max_concurrent
        self.timeout_seconds = timeout_seconds
        self.max_queue_size = max_queue_size
        
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=max_queue_size)
        self.workers: List[asyncio.Task] = []
        self.running = False
        self.active_jobs: Dict[str, Dict[str, Any]] = {}
    
    async def start(self, handler: Callable[[Dict[str, Any]], Awaitable[None]]):
        self.running = True
        
        for i in range(self.max_concurrent):
            worker = asyncio.create_task(self._worker(i, handler))
            self.workers.append(worker)
    
    async def stop(self):
        self.running = False
        await self.queue.join()
        
        for worker in self.workers:
            worker.cancel()
        
        await asyncio.gather(*self.workers, return_exceptions=True)
    
    async def enqueue(self, job: Dict[str, Any]) -> bool:
        if self.queue.full():
            logger.warning("Queue is full", user_id=job.get("user_id"))
            return False
        
        if "job_id" not in job:
            job["job_id"] = str(uuid.uuid4())
        
        job["enqueued_at"] = datetime.now(timezone.utc).isoformat()
        await self.queue.put(job)
        
        return True
    
    async def _worker(
        self, 
        worker_id: int, 
        handler: Callable[[Dict[str, Any]], Awaitable[None]]
    ) -> None:
        while self.running:
            job = None
            try:
                try:
                    job = await asyncio.wait_for(self.queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                
                job_id = job.get("job_id", "unknown")
                self.active_jobs[job_id] = job
                
                try:
                    await asyncio.wait_for(handler(job), timeout=self.timeout_seconds)
                except asyncio.TimeoutError:
                    logger.error(
                        "Job timeout", 
                        user_id=job.get("user_id"), 
                        error_code="JOB_TIMEOUT"
                    )
                except Exception as e:
                    logger.error(
                        f"Worker error: {e}", 
                        user_id=job.get("user_id"), 
                        error_code="WORKER_ERROR"
                    )
                finally:
                    self.queue.task_done()
                    self.active_jobs.pop(job_id, None)
            except asyncio.CancelledError:
                if job:
                    self.queue.task_done()
                break
            except Exception as e:
                logger.error(f"Worker fatal error: {e}", error_code="WORKER_FATAL_ERROR")
                if job:
                    self.queue.task_done()
    
    def is_full(self) -> bool:
        return self.queue.full()
