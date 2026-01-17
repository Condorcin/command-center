#!/bin/bash

# Script para exportar la base de datos D1 de producción a SQL
# Uso: ./scripts/export-db-prod.sh [output_file]

OUTPUT_FILE=${1:-"db-export-prod-$(date +%Y%m%d-%H%M%S).sql"}
DB_NAME="orbix-db"

echo "📦 Exportando base de datos de producción '$DB_NAME'..."
echo "📄 Archivo de salida: $OUTPUT_FILE"
echo "⚠️  Esto exportará datos de PRODUCCIÓN"

read -p "¿Continuar? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "❌ Exportación cancelada"
  exit 1
fi

# Exportar base de datos de producción
wrangler d1 export $DB_NAME --output $OUTPUT_FILE

if [ $? -eq 0 ]; then
  echo "✅ Exportación completada: $OUTPUT_FILE"
  echo "📊 Tamaño del archivo: $(du -h $OUTPUT_FILE | cut -f1)"
else
  echo "❌ Error al exportar la base de datos"
  exit 1
fi
