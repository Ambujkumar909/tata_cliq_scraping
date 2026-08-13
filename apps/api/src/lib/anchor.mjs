/**
 * Resolve a CLIQ product id to a canonical anchor, whatever its provenance.
 *
 * Tries the ingested catalog, then the durably-saved ad-hoc anchors, then the
 * live PDP. Shared by the paste-a-link route and the bulk importer so the two
 * can never disagree about what a product id resolves to.
 */
import { store } from '../store.mjs';
import { fetchCliqAnchor } from '../sources/tatacliq.mjs';

export async function resolveOrFetchAnchor(id) {
  if (!id) return { ok: false, reason: 'no_product_id' };

  const known = await store.resolve(id);
  if (known) return { ok: true, anchor: known, inCatalog: !known._transient, fetched: false };

  const res = await fetchCliqAnchor(id);
  if (!res.ok) return { ok: false, reason: res.reason };

  store.addTransient(res.anchor);
  return { ok: true, anchor: res.anchor, inCatalog: false, fetched: true };
}

/** Human-readable reason a product id could not be resolved. */
export function anchorErrorMessage(id, reason) {
  return reason === 'not_found'
    ? `Tata CLIQ has no product with id ${id}.`
    : `Could not read ${id} from Tata CLIQ (${reason}).`;
}
