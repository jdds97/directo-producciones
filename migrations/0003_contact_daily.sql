-- Tope diario global del formulario (DAILY_CAP en src/lib/contact-delivery.ts): intentos de envío al proveedor por día UTC,
-- con la persistencia apagada o encendida. Sin datos personales. Migración aditiva: el código anterior la ignora.
CREATE TABLE IF NOT EXISTS contact_daily (
  day TEXT PRIMARY KEY NOT NULL, -- AAAA-MM-DD (UTC)
  sends INTEGER NOT NULL DEFAULT 0
);
