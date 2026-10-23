const createMetrics = () => {
  const metrics = {
    startedAt: new Date().toISOString(),
    totalRequests: 0,
    totalResponseTimeMs: 0,
    byMethod: {},
    byStatus: {},
  };

  return {
    record({ method, status, durationMs }) {
      metrics.totalRequests += 1;
      metrics.totalResponseTimeMs += durationMs;

      metrics.byMethod[method] = (metrics.byMethod[method] ?? 0) + 1;

      const statusGroup = `${Math.floor(status / 100)}xx`;
      metrics.byStatus[statusGroup] = (metrics.byStatus[statusGroup] ?? 0) + 1;
    },

    snapshot() {
      return {
        ...metrics,
        averageResponseTimeMs: metrics.totalRequests
          ? Number((metrics.totalResponseTimeMs / metrics.totalRequests).toFixed(2))
          : 0,
        byMethod: { ...metrics.byMethod },
        byStatus: { ...metrics.byStatus },
      };
    },
  };
};

export { createMetrics };