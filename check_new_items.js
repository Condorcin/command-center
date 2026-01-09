// Script temporal para verificar cuántos de los IDs obtenidos son nuevos
// Uso: node check_new_items.js <global_seller_id>

const fs = require('fs');

// Leer los IDs obtenidos
const obtainedIds = fs.readFileSync('/tmp/all_unique_ids.txt', 'utf-8')
  .split('\n')
  .filter(line => line.trim())
  .map(line => line.trim());

console.log(`\n=== Verificación de Items Nuevos ===\n`);
console.log(`Total IDs obtenidos de estrategias agresivas: ${obtainedIds.length}`);
console.log(`\nPara verificar cuántos son nuevos, necesitas:`);
console.log(`1. El global_seller_id de tu cuenta`);
console.log(`2. Ejecutar esta consulta en tu BD:`);
console.log(`\nSELECT ml_item_id FROM items WHERE global_seller_id = '<TU_GLOBAL_SELLER_ID>' AND ml_item_id IN (${obtainedIds.slice(0, 5).map(id => `'${id}'`).join(', ')}, ...);`);
console.log(`\nO usar el endpoint de la API:`);
console.log(`POST /api/global-sellers/<global_seller_id>/items/check`);
console.log(`Body: { "ml_item_ids": [${obtainedIds.slice(0, 3).map(id => `"${id}"`).join(', ')}, ...] }`);

