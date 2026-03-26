import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

export type SellerOperateGate = {
  hasPhone: boolean;
  hasDefaultAddress: boolean;
  hasKitchenTitle: boolean;
  hasKitchenDescription: boolean;
  hasDeliveryRadius: boolean;
  hasWorkingHours: boolean;
  profileComplete: boolean;
  complianceRequiredCount: number;
  complianceUploadedRequiredCount: number;
  complianceMissingRequiredCount: number;
  canOperate: boolean;
};

async function ensureSellerComplianceAssignments(queryable: Queryable, sellerId: string) {
  await queryable.query(
    `INSERT INTO seller_compliance_documents (
       seller_id,
       document_list_id,
       is_required,
       status,
       version,
       is_current,
       created_at,
       updated_at
     )
     SELECT $1, cdl.id, cdl.is_required_default, 'requested', 1, TRUE, now(), now()
     FROM compliance_documents_list cdl
     WHERE cdl.is_active = TRUE
       AND NOT EXISTS (
         SELECT 1
         FROM seller_compliance_documents scd
         WHERE scd.seller_id = $1
           AND scd.document_list_id = cdl.id
           AND scd.is_current = TRUE
       )`,
    [sellerId],
  );
}

export async function getSellerOperateGate(queryable: Queryable, sellerId: string): Promise<SellerOperateGate | null> {
  const profileResult = await queryable.query<{
    phone: string | null;
    kitchen_title: string | null;
    kitchen_description: string | null;
    delivery_radius_km: string | null;
    working_hours_json: unknown;
    has_default_address: boolean;
  }>(
    `SELECT
       u.phone,
       u.kitchen_title,
       u.kitchen_description,
       u.delivery_radius_km::text,
       u.working_hours_json,
       EXISTS (
         SELECT 1
         FROM user_addresses ua
         WHERE ua.user_id = u.id
           AND ua.is_default = TRUE
       ) AS has_default_address
     FROM users u
     WHERE u.id = $1
       AND u.is_active = TRUE`,
    [sellerId],
  );
  if ((profileResult.rowCount ?? 0) === 0) return null;

  await ensureSellerComplianceAssignments(queryable, sellerId);

  const complianceCounts = await queryable.query<{
    required_count: string;
    uploaded_count: string;
  }>(
    `SELECT
       count(*)::text AS required_count,
       count(*) FILTER (
         WHERE scd.id IS NOT NULL
           AND scd.status IN ('uploaded', 'approved')
           AND coalesce(scd.expired, FALSE) = FALSE
           AND (scd.expires_at IS NULL OR scd.expires_at > now())
       )::text AS uploaded_count
     FROM compliance_documents_list cdl
     LEFT JOIN seller_compliance_documents scd
       ON scd.document_list_id = cdl.id
      AND scd.seller_id = $1
      AND scd.is_current = TRUE
     WHERE cdl.is_active = TRUE
       AND cdl.is_required_default = TRUE`,
    [sellerId],
  );

  const row = profileResult.rows[0];
  const hasPhone = Boolean(row.phone?.trim());
  const hasDefaultAddress = Boolean(row.has_default_address);
  const hasKitchenTitle = Boolean(row.kitchen_title?.trim());
  const hasKitchenDescription = Boolean(row.kitchen_description?.trim());
  const hasDeliveryRadius = Boolean(row.delivery_radius_km);
  const hasWorkingHours = Array.isArray(row.working_hours_json) && row.working_hours_json.length > 0;
  const profileComplete = hasPhone && hasDefaultAddress && hasKitchenTitle && hasKitchenDescription && hasDeliveryRadius && hasWorkingHours;

  const complianceRequiredCount = Number(complianceCounts.rows[0]?.required_count ?? "0");
  const complianceUploadedRequiredCount = Number(complianceCounts.rows[0]?.uploaded_count ?? "0");
  const complianceMissingRequiredCount = Math.max(0, complianceRequiredCount - complianceUploadedRequiredCount);
  const canOperate = profileComplete && complianceMissingRequiredCount === 0;

  return {
    hasPhone,
    hasDefaultAddress,
    hasKitchenTitle,
    hasKitchenDescription,
    hasDeliveryRadius,
    hasWorkingHours,
    profileComplete,
    complianceRequiredCount,
    complianceUploadedRequiredCount,
    complianceMissingRequiredCount,
    canOperate,
  };
}
