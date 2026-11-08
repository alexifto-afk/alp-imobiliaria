
import PDFDocument from 'pdfkit';

const AZUL = '#14233D';
const DOURADO = '#B58A40';
const CINZA = '#667085';
const CLARO = '#E5E7EB';

function dinheiro(centavos) {
  return (Number(centavos || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function dataBR(data) {
  if (!data) return 'Não informada';
  return new Date(data).toLocaleDateString('pt-BR', {
    timeZone: 'America/Araguaina'
  });
}

function campo(doc, titulo, valor, x, y, largura = 230) {
  doc.font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text(titulo, x, y, { width: largura });

  doc.font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(AZUL)
    .text(String(valor ?? 'Não informado'), x, y + 15, {
      width: largura
    });
}

export function gerarReciboPDF(dados, logoPath = null) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    info: {
      Title: 'Comprovante de Pagamento - A.L.P Imobiliária',
      Author: 'A.L.P Imobiliária'
    }
  });

  const x = 48;
  const direita = 320;
  const largura = 499;

  // Cabeçalho
  doc.font('Helvetica-Bold')
    .fontSize(19)
    .fillColor(AZUL)
    .text('Comprovante de Pagamento', x, 65, {
      width: 330
    });

  doc.font('Helvetica')
    .fontSize(9)
    .fillColor(CINZA)
    .text(`Emitido em ${dataBR(new Date())}`, x, 94);

  if (logoPath) {
    try {
      doc.image(logoPath, 415, 50, {
        fit: [130, 75],
        align: 'center'
      });
    } catch {
      doc.font('Helvetica-Bold')
        .fontSize(16)
        .fillColor(DOURADO)
        .text('A.L.P', 445, 65);
    }
  } else {
    doc.font('Helvetica-Bold')
      .fontSize(16)
      .fillColor(DOURADO)
      .text('A.L.P', 445, 65);
  }

  doc.moveTo(x, 140)
    .lineTo(547, 140)
    .strokeColor(CLARO)
    .stroke();

  // Dados do comprovante
  campo(doc, 'Número do recibo', dados.numeroRecibo, x, 165);
  campo(doc, 'Identificação da transação', dados.transacao, direita, 165);

  campo(doc, 'Nome do cliente', dados.cliente, x, 225);
  campo(doc, 'CPF do cliente', dados.cpf, direita, 225);

  campo(doc, 'Imóvel', dados.imovel, x, 285);
  campo(doc, 'Contrato', dados.contrato, direita, 285);

  campo(doc, 'Forma de pagamento', 'PIX', x, 345);
  campo(doc, 'Pago em', dataBR(dados.dataPagamento), direita, 345);

  // Detalhamento
  doc.font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(AZUL)
    .text('Detalhamento do pagamento', x, 425);

  doc.rect(x, 450, largura, 30).fill(AZUL);

  doc.font('Helvetica-Bold')
    .fontSize(9)
    .fillColor('#FFFFFF')
    .text('Descrição', 60, 461)
    .text('Vencimento', 310, 461)
    .text('Valor', 445, 461);

  doc.font('Helvetica')
    .fontSize(9)
    .fillColor(AZUL)
    .text(`Parcela ${dados.numeroParcela}`, 60, 493, {
      width: 235
    })
    .text(dataBR(dados.vencimento), 310, 493)
    .text(dinheiro(dados.valorCentavos), 435, 493, {
      width: 100,
      align: 'right'
    });

  doc.moveTo(x, 523)
    .lineTo(547, 523)
    .strokeColor(CLARO)
    .stroke();

  // Total
  doc.font('Helvetica')
    .fontSize(10)
    .fillColor(CINZA)
    .text('Total recebido', 345, 548);

  doc.font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(AZUL)
    .text(dinheiro(dados.valorCentavos), 345, 565, {
      width: 190,
      align: 'right'
    });

  // Rodapé
  doc.moveTo(150, 690)
    .lineTo(445, 690)
    .strokeColor(DOURADO)
    .stroke();

  doc.font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(AZUL)
    .text('A.L.P Imobiliária', 150, 705, {
      width: 295,
      align: 'center'
    });

  doc.font('Helvetica')
    .fontSize(8)
    .fillColor(CINZA)
    .text('Comprovante referente ao pagamento identificado acima.', 85, 735, {
      width: 425,
      align: 'center'
    });

  doc.end();
  return doc;
}

