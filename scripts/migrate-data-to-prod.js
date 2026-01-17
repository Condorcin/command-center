#!/usr/bin/env node

/**
 * Script Node.js para migración de datos de desarrollo a producción
 * Migra items (CBTs) de la base de datos local a producción
 * 
 * Uso: node scripts/migrate-data-to-prod.js [--incremental] [--timestamp=UNIX_TIMESTAMP]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DB_NAME = 'orbix-db';
const args = process.argv.slice(2);
const isIncremental = args.includes('--incremental');
const timestampArg = args.find(arg => arg.startsWith('--timestamp='));
const lastSync = timestampArg ? parseInt(timestampArg.split('=')[1]) : null;

console.log('🔄 Migración de datos a producción');
console.log('==================================\n');

// Función para ejecutar comandos wrangler
function execWrangler(command, isLocal = false) {
  const localFlag = isLocal ? '--local' : '';
  const fullCommand = `wrangler d1 execute ${DB_NAME} ${localFlag} ${command}`;
  
  try {
    const result = execSync(fullCommand, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return JSON.parse(result);
  } catch (error) {
    console.error(`Error ejecutando: ${fullCommand}`);
    console.error(error.message);
    throw error;
  }
}

// Función para obtener conteo de items
function getItemCount(isLocal, sinceTimestamp = null) {
  let query = 'SELECT COUNT(*) as count FROM items';
  if (sinceTimestamp) {
    query += ` WHERE updated_at > ${sinceTimestamp} OR synced_at > ${sinceTimestamp}`;
  }
  
  const result = execWrangler(`--command "${query}"`, isLocal);
  return parseInt(result[0]?.results[0]?.count || 0);
}

// Función para exportar items a SQL
function exportItemsToSQL(isLocal, sinceTimestamp = null, outputFile) {
  let query = `
    SELECT 
      id, global_seller_id, ml_item_id, site_id, title, price, currency_id,
      available_quantity, sold_quantity, status, listing_type_id, condition,
      permalink, thumbnail, category_id, start_time, stop_time, end_time,
      created_at, updated_at, synced_at, metadata
    FROM items
  `;
  
  if (sinceTimestamp) {
    query += ` WHERE updated_at > ${sinceTimestamp} OR synced_at > ${sinceTimestamp}`;
  }
  
  // Obtener items
  const result = execWrangler(`--command "${query}"`, isLocal);
  const items = result[0]?.results || [];
  
  if (items.length === 0) {
    console.log('⚠️  No hay items para migrar');
    return 0;
  }
  
  // Generar SQL con INSERT OR REPLACE
  const sqlLines = items.map(item => {
    const values = [
      `'${item.id}'`,
      `'${item.global_seller_id}'`,
      `'${item.ml_item_id}'`,
      item.site_id ? `'${String(item.site_id).replace(/'/g, "''")}'` : 'NULL',
      item.title ? `'${String(item.title).replace(/'/g, "''")}'` : 'NULL',
      item.price !== null && item.price !== undefined ? item.price : 'NULL',
      item.currency_id ? `'${String(item.currency_id).replace(/'/g, "''")}'` : 'NULL',
      item.available_quantity || 0,
      item.sold_quantity || 0,
      `'${item.status}'`,
      item.listing_type_id ? `'${String(item.listing_type_id).replace(/'/g, "''")}'` : 'NULL',
      item.condition ? `'${String(item.condition).replace(/'/g, "''")}'` : 'NULL',
      item.permalink ? `'${String(item.permalink).replace(/'/g, "''")}'` : 'NULL',
      item.thumbnail ? `'${String(item.thumbnail).replace(/'/g, "''")}'` : 'NULL',
      item.category_id ? `'${String(item.category_id).replace(/'/g, "''")}'` : 'NULL',
      item.start_time !== null && item.start_time !== undefined ? item.start_time : 'NULL',
      item.stop_time !== null && item.stop_time !== undefined ? item.stop_time : 'NULL',
      item.end_time !== null && item.end_time !== undefined ? item.end_time : 'NULL',
      item.created_at,
      item.updated_at,
      item.synced_at !== null && item.synced_at !== undefined ? item.synced_at : 'NULL',
      item.metadata ? `'${String(item.metadata).replace(/'/g, "''")}'` : 'NULL'
    ].join(', ');
    
    return `INSERT OR REPLACE INTO items (
      id, global_seller_id, ml_item_id, site_id, title, price, currency_id,
      available_quantity, sold_quantity, status, listing_type_id, condition,
      permalink, thumbnail, category_id, start_time, stop_time, end_time,
      created_at, updated_at, synced_at, metadata
    ) VALUES (${values});`;
  });
  
  // Escribir archivo SQL
  fs.writeFileSync(outputFile, sqlLines.join('\n') + '\n', 'utf-8');
  
  return items.length;
}

// Función principal
async function main() {
  try {
    // Paso 1: Verificar estado
    console.log('📊 Verificando estado de las bases de datos...\n');
    
    const localCount = getItemCount(true);
    const prodCount = getItemCount(false);
    
    console.log(`📦 Items en desarrollo (local): ${localCount.toLocaleString()}`);
    console.log(`📦 Items en producción: ${prodCount.toLocaleString()}\n`);
    
    if (localCount === 0) {
      console.log('✅ No hay items para migrar');
      return;
    }
    
    // Paso 2: Exportar items
    const tempFile = `temp-migration-${Date.now()}.sql`;
    console.log('📤 Exportando items de desarrollo...');
    
    let itemsToMigrate;
    if (isIncremental && lastSync) {
      console.log(`🔄 Modo incremental: desde timestamp ${lastSync}`);
      itemsToMigrate = exportItemsToSQL(true, lastSync, tempFile);
    } else {
      itemsToMigrate = exportItemsToSQL(true, null, tempFile);
    }
    
    if (itemsToMigrate === 0) {
      console.log('✅ No hay items nuevos para migrar');
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      return;
    }
    
    console.log(`📊 Items a migrar: ${itemsToMigrate.toLocaleString()}\n`);
    
    // Paso 3: Confirmar
    console.log('⚠️  ADVERTENCIA: Esto migrará datos a PRODUCCIÓN');
    console.log(`📊 Items a migrar: ${itemsToMigrate.toLocaleString()}`);
    console.log('\nPresiona Ctrl+C para cancelar, o Enter para continuar...');
    
    // Esperar confirmación del usuario
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('¿Continuar con la migración? (y/N): ', resolve);
    });
    
    rl.close();
    
    if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
      console.log('❌ Migración cancelada');
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      return;
    }
    
    // Paso 4: Importar a producción
    console.log('\n📥 Importando a producción...');
    console.log('⏳ Esto puede tardar varios minutos...\n');
    
    try {
      execSync(`wrangler d1 execute ${DB_NAME} --file ${tempFile}`, {
        stdio: 'inherit'
      });
      
      console.log('\n✅ Migración completada exitosamente');
      console.log(`📊 Items migrados: ${itemsToMigrate.toLocaleString()}`);
      
      // Obtener nuevo timestamp
      const currentTimestamp = Math.floor(Date.now() / 1000);
      console.log(`\n💾 Timestamp actual: ${currentTimestamp}`);
      console.log('💡 Para próxima migración incremental:');
      console.log(`   node scripts/migrate-data-to-prod.js --incremental --timestamp=${currentTimestamp}`);
      
    } catch (error) {
      console.error('\n❌ Error al importar a producción');
      console.error(error.message);
      throw error;
    } finally {
      // Limpiar archivo temporal
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
        console.log('\n🧹 Archivo temporal eliminado');
      }
    }
    
  } catch (error) {
    console.error('\n❌ Error durante la migración:');
    console.error(error.message);
    process.exit(1);
  }
}

// Ejecutar
main();
