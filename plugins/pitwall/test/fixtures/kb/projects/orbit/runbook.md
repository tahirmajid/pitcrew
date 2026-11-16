# Orbit runbook

When the queue depth alarm fires, scale the workers first. If the compactor stalls, restart it and check disk space on the staging volume. Escalate to the on-call after fifteen minutes.
