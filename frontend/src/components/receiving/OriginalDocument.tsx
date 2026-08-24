import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FileText, Paperclip, Trash2, Upload } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { ContentCard } from '@/components/layout/page';
import { ACCEPTED_ATTACHMENT_TYPES, formatFileSize, uploadReceiptAttachment, type ReceiptAttachment } from '@/lib/receipt-attachment';

/**
 * PHASE 22 — เอกสารต้นฉบับจากผู้ขาย (ไม่บังคับ)
 *
 * รับสินค้าได้ตามปกติโดยไม่ต้องแนบไฟล์ ส่วนนี้จึงไม่ใช่ช่องบังคับ
 * และตั้งใจให้เล็ก ไม่กินพื้นที่ของฟอร์มรับของ
 *
 * ไฟล์ต้นฉบับเป็นหลักฐานประกอบ ไม่ใช่แหล่งความจริงของรายการรับของ
 * และไม่แทนที่ใบรับของของ S2A
 */

export function OriginalDocumentSection({ receiptId, canEdit }: { receiptId?: string; canEdit: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['receipt-attachments', receiptId],
    queryFn: () => apiClient.get<ReceiptAttachment[]>(`/business/receiving/${receiptId}/attachments`),
    enabled: Boolean(receiptId),
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) => apiClient.delete(`/business/receiving/${receiptId}/attachments/${attachmentId}`),
    onSuccess: () => {
      toast('นำไฟล์ต้นฉบับออกแล้ว');
      void qc.invalidateQueries({ queryKey: ['receipt-attachments', receiptId] });
    },
    onError: (e: unknown) => toast(e instanceof Error ? e.message : 'นำไฟล์ออกไม่สำเร็จ'),
  });

  const upload = async (file: File) => {
    if (!receiptId) return;
    setBusy(true);
    try {
      await uploadReceiptAttachment(receiptId, file);
      toast('แนบไฟล์ต้นฉบับแล้ว');
      void qc.invalidateQueries({ queryKey: ['receipt-attachments', receiptId] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'แนบไฟล์ไม่สำเร็จ');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const rows = query.data ?? [];

  return (
    <ContentCard
      className="orig-doc"
      title={<><Paperclip aria-hidden width={17} />เอกสารต้นฉบับจากผู้ขาย</>}
      description="ไม่บังคับ สามารถรับสินค้าได้ตามปกติโดยไม่แนบไฟล์"
    >
      {!receiptId && <p className="orig-doc-hint">บันทึกร่างใบรับของก่อน แล้วจึงแนบไฟล์ต้นฉบับได้</p>}

      {receiptId && rows.length === 0 && (
        <p className="orig-doc-hint">ยังไม่มีไฟล์ต้นฉบับแนบไว้</p>
      )}

      {rows.length > 0 && (
        <ul className="orig-doc-list">
          {rows.map((file) => (
            <li key={file.id}>
              <span className="od-icon" aria-hidden><FileText /></span>
              <span className="od-main">
                <a href={file.url} target="_blank" rel="noopener noreferrer">{file.originalName}</a>
                <small>{file.mimeType.split('/').pop()?.toUpperCase()} · {formatFileSize(file.sizeBytes)}</small>
              </span>
              {canEdit && (
                <button type="button" className="icon-btn" aria-label={`นำ ${file.originalName} ออก`}
                  disabled={remove.isPending} onClick={() => remove.mutate(file.id)}>
                  <Trash2 aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {receiptId && canEdit && (
        <>
          <input
            ref={inputRef} type="file" className="sr-only"
            accept={ACCEPTED_ATTACHMENT_TYPES.join(',')}
            aria-label="เลือกไฟล์เอกสารต้นฉบับ"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <button type="button" className="btn" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload aria-hidden width={16} />{busy ? 'กำลังอัปโหลด…' : 'แนบไฟล์'}
          </button>
          <span className="orig-doc-hint">รองรับ PDF, JPG, PNG และ WEBP</span>
        </>
      )}

      {receiptId && !canEdit && rows.length > 0 && (
        <p className="orig-doc-hint">
          <AlertTriangle aria-hidden width={14} />
          ใบรับของนี้ยืนยันแล้ว ไฟล์ต้นฉบับจึงเป็นหลักฐานที่แก้ไขไม่ได้
        </p>
      )}
    </ContentCard>
  );
}
