import { nowIso } from './time.js';

export async function writeAudit(db, {
  userId = null,
  aksi,
  tabel,
  recordId,
  dataBefore = null,
  dataAfter = null,
  ip = null,
}) {
  await db.exec(
    `INSERT INTO audit_log
       (user_id, aksi, tabel_terkait, record_id, data_before, data_after, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    aksi,
    tabel,
    String(recordId),
    dataBefore === null ? null : JSON.stringify(dataBefore),
    dataAfter === null ? null : JSON.stringify(dataAfter),
    ip,
    nowIso()
  );
}