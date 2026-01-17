#!/bin/bash

# Script para exportar la base de datos D1 local a SQL
# Uso: ./scripts/export-db.sh [output_file]

OUTPUT_FILE=${1:-"db-export-$(date +%Y%m%d-%H%M%S).sql"}
DB_NAME="orbix-db"

echo "📦 Exportando base de datos local '$DB_NAME'..."
echo "📄 Archivo de salida: $OUTPUT_FILE"

# Exportar base de datos local
wrangler d1 export $DB_NAME --local --output $OUTPUT_FILE

if [ $? -eq 0 ]; then
  echo "✅ Exportación completada: $OUTPUT_FILE"
  echo "📊 Tamaño del archivo: $(du -h $OUTPUT_FILE | cut -f1)"
else
  echo "❌ Error al exportar la base de datos"
  exit 1
fi
