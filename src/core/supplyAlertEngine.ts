import type { ProductItem } from './queueSupplyRules';

export type SupplyAlertSeverity = 'low' | 'critical';
export type SupplyAlertStatus = 'active' | 'acknowledged' | 'resolved';
export type SupplyTriggerSource =
  | 'db_threshold_sweep'
  | 'db_order_decrement'
  | 'clinical_consumption'
  | 'threshold_policy_update'
  | 'restock_replenishment';

export interface SupplyAlertRecord {
  alertCode: string;
  sku: string;
  productName: string;
  supplierName: string;
  stockQty: number;
  reorderThreshold: number;
  criticalThreshold: number;
  deficitUnits: number;
  suggestedReorderQty: number;
  severity: SupplyAlertSeverity;
  status: SupplyAlertStatus;
  triggeredBy: SupplyTriggerSource;
  smsDispatchSummary: string;
  createdAt: string;
  updatedAt: string;
  acknowledgedBy?: string;
}

export interface SupplyAlertSummary {
  totalAlerts: number;
  activeCount: number;
  acknowledgedCount: number;
  resolvedCount: number;
  unacknowledgedCount: number;
  criticalActiveCount: number;
  lowActiveCount: number;
}

export interface ThresholdEvaluationOutcome {
  alerts: SupplyAlertRecord[];
  newlyTriggered: SupplyAlertRecord[];
  escalatedToCritical: SupplyAlertRecord[];
  autoResolved: SupplyAlertRecord[];
  summary: SupplyAlertSummary;
}

export function computeCriticalThreshold(reorderThreshold: number): number {
  const safeReorder = Math.max(1, Math.floor(reorderThreshold));
  return Math.max(1, Math.floor(safeReorder * 0.4));
}

export function evaluateProductThreshold(
  item: Pick<ProductItem, 'sku' | 'name' | 'supplierName' | 'stockQty' | 'reorderThreshold'>
): {
  breached: boolean;
  severity: SupplyAlertSeverity | null;
  criticalThreshold: number;
  deficitUnits: number;
  suggestedReorderQty: number;
} {
  const reorderThreshold = Math.max(1, Math.floor(item.reorderThreshold));
  const criticalThreshold = computeCriticalThreshold(reorderThreshold);
  const stockQty = Math.max(0, Math.floor(item.stockQty));

  if (stockQty > reorderThreshold) {
    return {
      breached: false,
      severity: null,
      criticalThreshold,
      deficitUnits: 0,
      suggestedReorderQty: 0,
    };
  }

  const severity: SupplyAlertSeverity = stockQty <= criticalThreshold ? 'critical' : 'low';
  const deficitUnits = Math.max(1, reorderThreshold - stockQty + (stockQty === reorderThreshold ? 1 : 0));
  const suggestedReorderQty = Math.max(reorderThreshold * 2 - stockQty, 20);

  return {
    breached: true,
    severity,
    criticalThreshold,
    deficitUnits,
    suggestedReorderQty,
  };
}

export function buildSupplyAlertSmsBroadcast(alert: {
  alertCode: string;
  sku: string;
  productName: string;
  stockQty: number;
  reorderThreshold: number;
  severity: SupplyAlertSeverity;
  supplierName: string;
}): string {
  const level = alert.severity === 'critical' ? 'CRITICAL STOCK' : 'LOW STOCK';
  return `[CAREGRID ${level}] ${alert.sku} (${alert.productName}) at ${alert.stockQty} units (threshold ${alert.reorderThreshold}). Supplier: ${alert.supplierName}. Ref ${alert.alertCode}.`;
}

export function makeAlertCode(sku: string): string {
  const sanitized = sku.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 16) || 'SKU';
  return `SUPALT-${sanitized}`;
}

export function summarizeSupplyAlerts(alerts: SupplyAlertRecord[]): SupplyAlertSummary {
  let activeCount = 0;
  let acknowledgedCount = 0;
  let resolvedCount = 0;
  let criticalActiveCount = 0;
  let lowActiveCount = 0;

  for (const alert of alerts) {
    if (alert.status === 'active') {
      activeCount += 1;
      if (alert.severity === 'critical') criticalActiveCount += 1;
      else lowActiveCount += 1;
    } else if (alert.status === 'acknowledged') {
      acknowledgedCount += 1;
    } else if (alert.status === 'resolved') {
      resolvedCount += 1;
    }
  }

  return {
    totalAlerts: alerts.length,
    activeCount,
    acknowledgedCount,
    resolvedCount,
    unacknowledgedCount: activeCount,
    criticalActiveCount,
    lowActiveCount,
  };
}

export function evaluateInventoryThresholdTrigger(
  products: ProductItem[],
  existingAlerts: SupplyAlertRecord[],
  triggeredBy: SupplyTriggerSource,
  nowIso = new Date().toISOString()
): ThresholdEvaluationOutcome {
  const bySku = new Map<string, SupplyAlertRecord>();
  for (const alert of existingAlerts) {
    bySku.set(alert.sku, { ...alert });
  }

  const newlyTriggered: SupplyAlertRecord[] = [];
  const escalatedToCritical: SupplyAlertRecord[] = [];
  const autoResolved: SupplyAlertRecord[] = [];

  for (const product of products) {
    const evalResult = evaluateProductThreshold(product);
    const existing = bySku.get(product.sku);

    if (evalResult.breached && evalResult.severity) {
      const alertCode = existing?.alertCode || makeAlertCode(product.sku);
      const smsDispatchSummary = buildSupplyAlertSmsBroadcast({
        alertCode,
        sku: product.sku,
        productName: product.name,
        stockQty: product.stockQty,
        reorderThreshold: product.reorderThreshold,
        severity: evalResult.severity,
        supplierName: product.supplierName,
      });

      if (!existing || existing.status === 'resolved') {
        const created: SupplyAlertRecord = {
          alertCode,
          sku: product.sku,
          productName: product.name,
          supplierName: product.supplierName,
          stockQty: product.stockQty,
          reorderThreshold: product.reorderThreshold,
          criticalThreshold: evalResult.criticalThreshold,
          deficitUnits: evalResult.deficitUnits,
          suggestedReorderQty: evalResult.suggestedReorderQty,
          severity: evalResult.severity,
          status: 'active',
          triggeredBy,
          smsDispatchSummary,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        bySku.set(product.sku, created);
        newlyTriggered.push(created);
      } else {
        const upgradedToCritical = existing.severity === 'low' && evalResult.severity === 'critical';
        const nextStatus: SupplyAlertStatus = upgradedToCritical ? 'active' : existing.status;
        const updated: SupplyAlertRecord = {
          ...existing,
          productName: product.name,
          supplierName: product.supplierName,
          stockQty: product.stockQty,
          reorderThreshold: product.reorderThreshold,
          criticalThreshold: evalResult.criticalThreshold,
          deficitUnits: evalResult.deficitUnits,
          suggestedReorderQty: evalResult.suggestedReorderQty,
          severity: evalResult.severity,
          status: nextStatus,
          triggeredBy: upgradedToCritical ? triggeredBy : existing.triggeredBy,
          smsDispatchSummary,
          updatedAt: nowIso,
        };
        bySku.set(product.sku, updated);
        if (upgradedToCritical) {
          escalatedToCritical.push(updated);
        }
      }
    } else if (existing && existing.status !== 'resolved') {
      const resolved: SupplyAlertRecord = {
        ...existing,
        stockQty: product.stockQty,
        reorderThreshold: product.reorderThreshold,
        criticalThreshold: evalResult.criticalThreshold,
        deficitUnits: 0,
        suggestedReorderQty: 0,
        status: 'resolved',
        triggeredBy: 'restock_replenishment',
        updatedAt: nowIso,
      };
      bySku.set(product.sku, resolved);
      autoResolved.push(resolved);
    }
  }

  const severityRank: Record<SupplyAlertSeverity, number> = { critical: 0, low: 1 };
  const statusRank: Record<SupplyAlertStatus, number> = { active: 0, acknowledged: 1, resolved: 2 };

  const alerts = [...bySku.values()].sort((a, b) => {
    const statusDiff = statusRank[a.status] - statusRank[b.status];
    if (statusDiff !== 0) return statusDiff;
    const sevDiff = severityRank[a.severity] - severityRank[b.severity];
    if (sevDiff !== 0) return sevDiff;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  return {
    alerts,
    newlyTriggered,
    escalatedToCritical,
    autoResolved,
    summary: summarizeSupplyAlerts(alerts),
  };
}
