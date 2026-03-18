import type { AdminLotRow, FoodLotDiff } from "../../types/lots";
import type { Language } from "../../types/core";
import { lotLifecycleLabel, toReadableText } from "../../lib/lots";
import { formatUiDate } from "../../lib/format";

type LotDetailContentProps = {
  lot: AdminLotRow;
  language: Language;
  labels: {
    lotNumber: string;
    lotLifecycle: string;
    lotQuantity: string;
    lotProducedAt: string;
    lotSaleWindow: string;
  };
  lotDiff?: FoodLotDiff | null;
  addedIngredients?: string[];
  addedAllergens?: string[];
};

export function LotDetailContent({ lot, language, labels, lotDiff, addedIngredients = [], addedAllergens = [] }: LotDetailContentProps) {
  const hasDiff = lotDiff && (lotDiff.recipeChanged || lotDiff.ingredientsChanged || lotDiff.allergensChanged);

  return (
    <div className="foods-detail-text-block foods-detail-lot-focus">
      {hasDiff ? (
        <div className="lot-diff-alert">
          <span className="lot-diff-alert-icon">⚠</span>
          <div>
            <span>
              {language === "tr"
                ? `Bu lot ana yemekten farklı: ${[lotDiff.recipeChanged && "Tarif", lotDiff.ingredientsChanged && "İçerikler", lotDiff.allergensChanged && "Alerjenler"].filter(Boolean).join(", ")}`
                : `This lot differs from the base food: ${[lotDiff.recipeChanged && "Recipe", lotDiff.ingredientsChanged && "Ingredients", lotDiff.allergensChanged && "Allergens"].filter(Boolean).join(", ")}`}
            </span>
            {lotDiff.ingredientsChanged ? (
              <p className="panel-meta">
                {language === "tr" ? "Eklenen malzemeler: " : "Added ingredients: "}
                {addedIngredients.length > 0 ? addedIngredients.join(", ") : "-"}
              </p>
            ) : null}
            {lotDiff.allergensChanged ? (
              <p className="panel-meta">
                {language === "tr" ? "Eklenen alerjenler: " : "Added allergens: "}
                <span className="foods-detail-allergen-text">{addedAllergens.length > 0 ? addedAllergens.join(", ") : "-"}</span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="foods-detail-grid">
        <div><span className="panel-meta">{labels.lotNumber}</span><strong>{lot.lot_number}</strong></div>
        <div><span className="panel-meta">{labels.lotLifecycle}</span><strong>{lotLifecycleLabel(lot.lifecycle_status, language)}</strong></div>
        <div><span className="panel-meta">{labels.lotQuantity}</span><strong>{`${lot.quantity_available}/${lot.quantity_produced}`}</strong></div>
        <div><span className="panel-meta">{labels.lotProducedAt}</span><strong>{formatUiDate(lot.produced_at, language)}</strong></div>
        <div><span className="panel-meta">{labels.lotSaleWindow}</span><strong>{`${formatUiDate(lot.sale_starts_at, language)} - ${formatUiDate(lot.sale_ends_at, language)}`}</strong></div>
        <div><span className="panel-meta">{language === "tr" ? "Son Kullanma Tarihi" : "Use By Date"}</span><strong>{formatUiDate(lot.use_by, language)}</strong></div>
      </div>

      <div className="foods-detail-grid">
        <div className={`foods-detail-text-block${lotDiff?.ingredientsChanged ? " foods-detail-text-block--warn" : ""}`}>
          <h4>{language === "tr" ? "Lot Malzemeler / Baharatlar" : "Lot Ingredients / Spices"}</h4>
          <p className="foods-detail-plain-text">{toReadableText(lot.ingredients_snapshot_json)}</p>
        </div>
        <div className={`foods-detail-text-block${lotDiff?.allergensChanged ? " foods-detail-text-block--warn" : ""}`}>
          <h4>{language === "tr" ? "Lot Alerjen" : "Lot Allergens"}</h4>
          <p className="foods-detail-plain-text foods-detail-allergen-text">{toReadableText(lot.allergens_snapshot_json)}</p>
        </div>
      </div>
    </div>
  );
}
