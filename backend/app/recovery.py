"""Recovery runs only while the single service is awake; durable intents survive sleep."""
import logging
from threading import Event, Thread

from .finance import gateway, read, write, find_purchase, now
from .payments import reconcile_purchase

log = logging.getLogger("reliefops.recovery")


def recover_once():
    for item in gateway("pending"):
        try:
            # Each side-effecting retry claims its operation version before submitting.
            # Captures/refunds with unknown results are looked up, never blindly repeated.
            reconcile_purchase(item["operation_id"], item["owner_id"], item["purchase_id"])
        except Exception:
            log.warning("A pending sandbox purchase still requires reconciliation; commitment retained.")
        finally:
            # Rotate unresolved purchases fairly without growing the decision history
            # with one repeated event per polling interval.
            for _ in range(3):
                try:
                    data = read(item["operation_id"], item["owner_id"])
                    find_purchase(data, item["purchase_id"])["last_reconciled_at"] = now()
                    write(data, item["owner_id"])
                    break
                except Exception:
                    continue


def start_worker():
    stop = Event()
    def loop():
        while not stop.is_set():
            try:
                recover_once()
            except Exception:
                log.warning("Recovery gateway temporarily unavailable; persisted work will retry while awake.")
            stop.wait(60)
    thread = Thread(target=loop, name="sandbox-recovery", daemon=True)
    thread.start()
    return stop, thread


if __name__ == "__main__":
    from pathlib import Path
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env")
    recover_once()
