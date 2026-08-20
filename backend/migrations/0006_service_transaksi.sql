-- Service HP langsung direferensikan dari transaksi (tanpa produk jasa terpisah).
-- Item transaksi ber-produk_id NULL namun mengarah ke service_hp.
ALTER TABLE transaksi_item ADD COLUMN service_hp_id INTEGER REFERENCES service_hp(id);
CREATE INDEX idx_transaksi_item_service ON transaksi_item(service_hp_id);