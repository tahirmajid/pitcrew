# Orbit architecture

Orbit is an event pipeline. Producers publish telemetry to a queue, workers batch it, and a compactor writes columnar files nightly. Backpressure is handled by pausing producers when the queue depth passes a threshold.
