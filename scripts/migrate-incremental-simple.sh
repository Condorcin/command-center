#!/bin/bash

# Script simplificado para migración incremental de items
# Exporta items de desarrollo e importa a producción usando wrangler d1 export/execute

DB_NAME="orbix-db"
TEMP_EXPORT="temp-local-export.sql"

echo "🔄 Migración incremental de items a producción"
echo "================================================"

# Paso 1: Exportar base de datos local
echo ""
echo "📦 Paso 1: Exportando base de datos local..."
wrangler d1 export $DB_NAME --local --output $TEMP_EXPORT

if [ $? -ne 0 ]; then
  echo "❌ Error al exportar base de datos local"
  exit 1
fi

echo "✅ Exportación completada: $TEMP_EXPORT"

# Paso 2: Extraer solo INSERTs de la tabla items
echo ""
echo "📝 Paso 2: Extrayendo datos de items..."
ITEMS_SQL="temp-items-only.sql"

# Extraer solo las líneas INSERT de la tabla items
grep -E "^INSERT INTO items|^INSERT OR" $TEMP_EXPORT > $ITEMS_SQL 2>/dev/null || {
  # Si no hay INSERT directo, buscar en el dump
  sed -n '/CREATE TABLE.*items/,/CREATE TABLE/p' $TEMP_EXPORT | grep -E "INSERT|^[0-9]+\|" > $ITEMS_SQL || {
    echo "⚠️  No se encontraron INSERTs directos, usando método alternativo..."
    # Método alternativo: usar wrangler d1 execute para generar SQL
    wrangler d1 execute $DB_NAME --local --command "
      SELECT 'INSERT OR REPLACE INTO items VALUES (''' || 
        id || ''', ''' || 
        global_seller_id || ''', ''' || 
        ml_item_id || ''', ' ||
        COALESCE('''' || site_id || '''', 'NULL') || ', ' ||
        COALESCE('''' || REPLACE(COALESCE(title, ''), '''', '''''') || '''', 'NULL') || ', ' ||
        COALESCE(price, 'NULL') || ', ' ||
        COALESCE('''' || currency_id || '''', 'NULL') || ', ' ||
        available_quantity || ', ' ||
        sold_quantity || ', ' ||
        '''' || status || ''', ' ||
        COALESCE('''' || listing_type_id || '''', 'NULL') || ', ' ||
        COALESCE('''' || condition || '''', 'NULL') || ', ' ||
        COALESCE('''' || permalink || '''', 'NULL') || ', ' ||
        COALESCE('''' || thumbnail || '''', 'NULL') || ', ' ||
        COALESCE('''' || category_id || '''', 'NULL') || ', ' ||
        COALESCE(start_time, 'NULL') || ', ' ||
        COALESCE(stop_time, 'NULL') || ', ' ||
        COALESCE(end_time, 'NULL') || ', ' ||
        created_at || ', ' ||
        updated_at || ', ' ||
        COALESCE(synced_at, 'NULL') || ', ' ||
        COALESCE('''' || REPLACE(COALESCE(metadata, ''), '''', '''''') || '''', 'NULL') ||
        ');'
      FROM items;
    " > $ITEMS_SQL 2>&1
  }
}

ITEM_COUNT=$(wc -l < $ITEMS_SQL 2>/dev/null || echo "0")
echo "📊 Líneas SQL generadas: $ITEM_COUNT"

if [ "$ITEM_COUNT" -eq 0 ]; then
  echo "⚠️  No se encontraron items para migrar"
  rm -f $TEMP_EXPORT $ITEMS_SQL
  exit 0
fi

# Paso 3: Confirmar migración
echo ""
echo "⚠️  ADVERTENCIA: Esto migrará datos a PRODUCCIÓN"
echo "📊 Items a migrar: ~$ITEM_COUNT"
read -p "¿Continuar con la migración? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Migración cancelada"
  rm -f $TEMP_EXPORT $ITEMS_SQL
  exit 1
fi

# Paso 4: Importar a producción
echo ""
echo "📤 Paso 3: Importando a producción..."
echo "⏳ Esto puede tardar varios minutos..."

# Usar wrangler d1 execute con el archivo SQL
wrangler d1 execute $DB_NAME --file $ITEMS_SQL

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Migración completada exitosamente"
  echo "📊 Items procesados: ~$ITEM_COUNT"
  
  # Obtener timestamp actual
  CURRENT_TIMESTAMP=$(date +%s)
  echo ""
  echo "💾 Timestamp actual: $CURRENT_TIMESTAMP"
  echo "💡 Para próxima migración incremental, usa:"
  echo "   npm run db:migrate:incremental"
else
  echo ""
  echo "❌ Error al importar a producción"
  echo "💡 Verifica los logs arriba para más detalles"
  rm -f $TEMP_EXPORT $ITEMS_SQL
  exit 1
fi

# Limpiar archivos temporales
rm -f $TEMP_EXPORT $ITEMS_SQL
echo ""
echo "🧹 Archivos temporales eliminados"
