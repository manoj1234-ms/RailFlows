import PDFDocument from 'pdfkit';

export class PdfService {
  static async generateETicket(data: {
    pnr: string;
    trainName: string;
    trainNumber: string;
    fromStation: string;
    toStation: string;
    departureTime: string;
    arrivalTime: string;
    date: string;
    passengers: { name: string; age: number; seat: string }[];
    price: number;
    status: string;
  }): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 100;
      const centerX = doc.page.width / 2;

      doc.font('Helvetica-Bold').fontSize(22).fillColor('#6C63FF')
        .text('RAILFLOW', centerX, 50, { align: 'center' })
        .fontSize(10).fillColor('#666')
        .text('High-Scale Intelligent Ticket Booking', centerX, 75, { align: 'center' });

      doc.moveDown(2);
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#333')
        .text('E-TICKET', centerX, undefined, { align: 'center' });

      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(11).fillColor('#333')
        .text(`PNR: ${data.pnr}`, { align: 'center' })
        .text(`Status: ${data.status}`, { align: 'center' });

      doc.moveDown(1.5);
      doc.rect(50, doc.y, pageWidth, 0).stroke('#6C63FF');
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(14).fillColor('#333')
        .text(data.trainName, 50, doc.y)
        .font('Helvetica').fontSize(11).fillColor('#666')
        .text(`Train: ${data.trainNumber}`);

      doc.moveDown(1);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#333');
      doc.text(`${data.fromStation}`, 50, doc.y, { continued: true });
      doc.font('Helvetica').fontSize(12).fillColor('#666')
        .text(`  --- ${data.departureTime}  →  ${data.arrivalTime} --->  `, { continued: true });
      doc.font('Helvetica-Bold').fillColor('#333')
        .text(`${data.toStation}`);

      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(10).fillColor('#888')
        .text(`Date: ${data.date}`);

      doc.moveDown(1.5);
      doc.rect(50, doc.y, pageWidth, 0).stroke('#6C63FF');
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#333')
        .text('Passengers');

      doc.moveDown(0.5);

      const tableTop = doc.y;
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#333');
      doc.text('Name', 50, tableTop);
      doc.text('Age', 280, tableTop);
      doc.text('Seat', 350, tableTop);
      doc.text('Fare', 430, tableTop);

      doc.moveDown(0.3);
      doc.rect(50, doc.y, pageWidth, 0).stroke('#ddd');

      doc.font('Helvetica').fontSize(10).fillColor('#555');
      let yPos = doc.y + 5;
      for (const p of data.passengers) {
        doc.text(p.name, 50, yPos);
        doc.text(String(p.age), 280, yPos);
        doc.text(p.seat, 350, yPos);
        yPos += 20;
      }

      doc.moveDown(1.5);
      doc.rect(50, doc.y, pageWidth, 0).stroke('#6C63FF');
      doc.moveDown(0.5);

      doc.font('Helvetica-Bold').fontSize(12).fillColor('#333')
        .text(`Total Fare: ₹${data.price}`, { align: 'right' });

      doc.moveDown(2);
      doc.fontSize(8).fillColor('#999')
        .text('This is a computer-generated e-ticket. No signature required.', centerX, undefined, { align: 'center' })
        .text('For support: support@railflow.app | PNR Enquiry: railflow.app/pnr', centerX, undefined, { align: 'center' });

      doc.end();
    });
  }
}
