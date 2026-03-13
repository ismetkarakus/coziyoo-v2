import { DICTIONARIES } from "../lib/i18n";
import type { Language } from "../types/core";

type Scenario = {
  id: string;
  titleTr: string;
  titleEn: string;
  priority: "P0" | "P1" | "P2";
  route: string;
  preconditionTr: string;
  preconditionEn: string;
  stepsTr: string[];
  stepsEn: string[];
  expectedTr: string[];
  expectedEn: string[];
};

const SCENARIOS: Scenario[] = [
  {
    id: "DOC-01",
    titleTr: "Satıcı yasal belge listesi görünüyor mu?",
    titleEn: "Seller legal document history is visible",
    priority: "P0",
    route: "/app/sellers",
    preconditionTr: "Belge yüklemiş en az 1 satıcı olmalı.",
    preconditionEn: "At least 1 seller with uploaded legal docs is required.",
    stepsTr: [
      "Satıcılar ekranından bir satıcı detayına gir.",
      "Legal sekmesine geç.",
      "Belge Geçmişi tablosunu incele.",
    ],
    stepsEn: [
      "Open a seller detail from Sellers page.",
      "Switch to Legal tab.",
      "Inspect document history table.",
    ],
    expectedTr: [
      "Yüklenme tarihi, belge tipi, dosya linki, durum, inceleme tarihi görünmeli.",
      "Dosya linki yeni sekmede açılmalı.",
    ],
    expectedEn: [
      "Uploaded at, type, file link, status and review date should be visible.",
      "File link should open in a new tab.",
    ],
  },
  {
    id: "DOC-02",
    titleTr: "Belge onaylama akışı",
    titleEn: "Legal document approval flow",
    priority: "P0",
    route: "/app/sellers",
    preconditionTr: "Durumu requested veya rejected olan belge olmalı.",
    preconditionEn: "A document with requested or rejected status is required.",
    stepsTr: ["Legal sekmesinde belge satırında Onayla butonuna tıkla."],
    stepsEn: ["Click Approve button in a legal document row."],
    expectedTr: [
      "Durum approved olmalı.",
      "Kaydedildi bildirimi görünmeli.",
      "Sayfa yenilenmeden satır güncellenmeli.",
    ],
    expectedEn: [
      "Status should become approved.",
      "Saved notification should appear.",
      "Row should update without manual page refresh.",
    ],
  },
  {
    id: "DOC-03",
    titleTr: "Belge reddetme akışı (gerekçe zorunlu)",
    titleEn: "Legal document rejection flow (reason required)",
    priority: "P0",
    route: "/app/sellers",
    preconditionTr: "Değerlendirilebilir bir belge satırı olmalı.",
    preconditionEn: "A reviewable legal document row is required.",
    stepsTr: [
      "Reddet butonuna tıkla.",
      "Açılan modalda gerekçe alanını boş bırakmayı dene.",
      "Gerekçe yazıp tekrar Reddet.",
    ],
    stepsEn: [
      "Click Reject.",
      "Try rejecting with an empty reason in modal.",
      "Enter reason and reject again.",
    ],
    expectedTr: [
      "Boş gerekçede onay butonu pasif kalmalı.",
      "Gerekçe girince red işlemi tamamlanmalı.",
      "Reddetme nedeni tabloda görünmeli.",
    ],
    expectedEn: [
      "Confirm reject button should stay disabled when reason is empty.",
      "Rejection should succeed after reason is entered.",
      "Rejection reason should be visible in table.",
    ],
  },
  {
    id: "DOC-04",
    titleTr: "Belgeyi tekrar beklemeye alma (requested)",
    titleEn: "Move legal document back to pending",
    priority: "P1",
    route: "/app/sellers",
    preconditionTr: "Onaylı veya reddedilmiş belge olmalı.",
    preconditionEn: "An approved or rejected document is required.",
    stepsTr: ["Legal satırında Beklemeye Al (Pend) aksiyonunu kullan."],
    stepsEn: ["Use Pend action in legal document row."],
    expectedTr: ["Durum requested olarak güncellenmeli."],
    expectedEn: ["Status should update to requested."],
  },
  {
    id: "DOC-05",
    titleTr: "Opsiyonel belge onay/red/pending akışı",
    titleEn: "Optional upload review flow",
    priority: "P0",
    route: "/app/sellers",
    preconditionTr: "Opsiyonel yükleme kaydı olmalı.",
    preconditionEn: "Optional upload record is required.",
    stepsTr: [
      "Legal > Opsiyonel Yüklemeler tablosuna git.",
      "Onayla, Reddet, Beklemeye Al aksiyonlarını test et.",
    ],
    stepsEn: [
      "Go to Legal > Optional uploads table.",
      "Test Approve, Reject and Pend actions.",
    ],
    expectedTr: [
      "Durumlar uploaded/approved/rejected arasında doğru geçmeli.",
      "Reddetmede gerekçe zorunlu olmalı.",
    ],
    expectedEn: [
      "Statuses should transition correctly among uploaded/approved/rejected.",
      "Rejection reason should be mandatory.",
    ],
  },
  {
    id: "DOC-06",
    titleTr: "Belge türü zorunluluk toggle testi",
    titleEn: "Document type required toggle",
    priority: "P1",
    route: "/app/sellers",
    preconditionTr: "Legal > Belge Türleri listesi dolu olmalı.",
    preconditionEn: "Legal > Document types list should be populated.",
    stepsTr: ["Bir belge türünde required checkbox değerini değiştir."],
    stepsEn: ["Toggle required checkbox for a document type."],
    expectedTr: ["İlgili satırda required alanı ve updated_at güncellenmeli."],
    expectedEn: ["Required value and updated_at should update for row."],
  },
  {
    id: "DOC-07",
    titleTr: "Kimlik dosyası görüntüleyici",
    titleEn: "Identity file viewer",
    priority: "P1",
    route: "/app/sellers",
    preconditionTr: "Kimlik/pasaport/selfie içeren en az bir dosya olmalı.",
    preconditionEn: "At least one identity/passport/selfie file should exist.",
    stepsTr: [
      "Satıcı Genel sekmesinden Kimlik Detayını Gör butonuna tıkla.",
      "Dosyalar arasında geçiş yap.",
      "Yeni sekmede aç ve yazdır aksiyonunu dene.",
    ],
    stepsEn: [
      "From seller General tab click View Identity Details.",
      "Switch between listed files.",
      "Try open in new tab and print actions.",
    ],
    expectedTr: ["PDF ise iframe, görsel ise img önizleme görünmeli."],
    expectedEn: ["PDF should render in iframe, image should render in img preview."],
  },
  {
    id: "CMP-01",
    titleTr: "Şikayet listesi filtre ve arama",
    titleEn: "Complaint list filtering and search",
    priority: "P0",
    route: "/app/investigation",
    preconditionTr: "Sistemde birden fazla şikayet kaydı olmalı.",
    preconditionEn: "System should contain multiple complaints.",
    stepsTr: [
      "Durum filtresini sırayla open/in_review/resolved/closed yap.",
      "Arama alanına sipariş no veya alıcı adı gir.",
    ],
    stepsEn: [
      "Switch status filter between open/in_review/resolved/closed.",
      "Search by order no or buyer name.",
    ],
    expectedTr: ["Liste, filtre ve arama ile tutarlı daralmalı."],
    expectedEn: ["List should narrow consistently with filter and search."],
  },
  {
    id: "CMP-02",
    titleTr: "Şikayet detay durum geçişleri",
    titleEn: "Complaint detail status transitions",
    priority: "P0",
    route: "/app/investigation",
    preconditionTr: "Detayına girilebilen bir şikayet kaydı olmalı.",
    preconditionEn: "A complaint row that can be opened is required.",
    stepsTr: [
      "Listeden bir şikayet aç.",
      "Durumu open > in_review > resolved > closed olarak değiştir.",
    ],
    stepsEn: [
      "Open a complaint from list.",
      "Change status open > in_review > resolved > closed.",
    ],
    expectedTr: ["Her tıklamada aktif durum butonu değişmeli ve kalıcı olmalı."],
    expectedEn: ["Active status button should update and persist on each click."],
  },
  {
    id: "CMP-03",
    titleTr: "Şikayet not ekleme",
    titleEn: "Complaint note creation",
    priority: "P0",
    route: "/app/investigation",
    preconditionTr: "Şikayet detayı açık olmalı.",
    preconditionEn: "Complaint detail page should be open.",
    stepsTr: ["Yeni not yaz ve Kaydet."],
    stepsEn: ["Enter a new note and Save."],
    expectedTr: ["Not tablosunda yeni satır admin bilgisi ve tarih ile görünmeli."],
    expectedEn: ["New note should appear with admin info and date in notes table."],
  },
  {
    id: "CMP-04",
    titleTr: "Şikayet CSV dışa aktarma",
    titleEn: "Complaint CSV export",
    priority: "P1",
    route: "/app/investigation",
    preconditionTr: "Filtre sonucu en az 1 kayıt olmalı.",
    preconditionEn: "At least one record should match active filter.",
    stepsTr: ["Excel'e Aktar butonuna tıkla, dosyayı aç."],
    stepsEn: ["Click Export button and open file."],
    expectedTr: ["CSV başlıkları doğru, satır sayısı filtre ile uyumlu olmalı."],
    expectedEn: ["CSV headers should be correct and row count should match filter."],
  },
  {
    id: "USR-01",
    titleTr: "Satıcı not/etiket yönetimi",
    titleEn: "Seller note/tag management",
    priority: "P1",
    route: "/app/sellers",
    preconditionTr: "Satıcı detay ekranı açık olmalı.",
    preconditionEn: "Seller detail page should be open.",
    stepsTr: ["Notes sekmesinde not ekle, düzenle, sil; etiket ekle/sil."],
    stepsEn: ["In Notes tab add/edit/delete note; add/delete tags."],
    expectedTr: ["Her işlem sonrası liste anında güncellenmeli."],
    expectedEn: ["List should update instantly after each operation."],
  },
  {
    id: "USR-02",
    titleTr: "Alıcı risk sinyalleri ve sipariş filtreleri",
    titleEn: "Buyer risk signals and order filters",
    priority: "P1",
    route: "/app/buyers",
    preconditionTr: "Alıcı detayında sipariş ve özet verisi olmalı.",
    preconditionEn: "Buyer detail should include orders and summary data.",
    stepsTr: [
      "Alıcı detaya gir.",
      "Sipariş sekmesinde tarih/durum/arama filtrelerini uygula.",
    ],
    stepsEn: [
      "Open buyer detail.",
      "Apply date/status/search filters in Orders tab.",
    ],
    expectedTr: ["Filtreli liste ile toplam metriklerde tutarsızlık olmamalı."],
    expectedEn: ["No mismatch between filtered list and displayed metrics."],
  },
  {
    id: "USR-03",
    titleTr: "Admin rolüne göre salt-okunur davranış",
    titleEn: "Read-only behavior by admin role",
    priority: "P0",
    route: "/app/sellers",
    preconditionTr: "admin ve super_admin iki farklı hesap olmalı.",
    preconditionEn: "Both admin and super_admin accounts should exist.",
    stepsTr: [
      "admin rolü ile giriş yap.",
      "Satıcı düzenleme, belge aksiyonu, adres güncelleme alanlarını test et.",
      "super_admin ile aynı adımları tekrar et.",
    ],
    stepsEn: [
      "Login with admin role.",
      "Try seller edit, legal actions and address update fields.",
      "Repeat with super_admin.",
    ],
    expectedTr: ["admin rolde buton/input pasif, super_admin rolde aktif olmalı."],
    expectedEn: ["Controls should be disabled for admin and enabled for super_admin."],
  },
  {
    id: "SYS-01",
    titleTr: "Global arama ile satıcı/alıcı/şikayet yönlendirme",
    titleEn: "Global search routing",
    priority: "P1",
    route: "/app/dashboard",
    preconditionTr: "Aranabilir kayıtlar bulunmalı.",
    preconditionEn: "Searchable entities should exist.",
    stepsTr: [
      "Üst arama butonundan modalı aç.",
      "2+ karakter ile arama yap.",
      "Sonuçlardan satıcı/alıcı/şikayet seç.",
    ],
    stepsEn: [
      "Open modal from top search button.",
      "Search with 2+ chars.",
      "Pick seller/buyer/complaint from results.",
    ],
    expectedTr: ["Seçilen sonuca doğru route ile gitmeli."],
    expectedEn: ["Should navigate to correct route for selected result."],
  },
  {
    id: "SYS-02",
    titleTr: "API Health badge davranışı",
    titleEn: "API health badge behavior",
    priority: "P2",
    route: "/app/dashboard",
    preconditionTr: "API erişimi aç/kapa yapılabilecek test ortamı.",
    preconditionEn: "Test environment where API availability can be toggled.",
    stepsTr: ["API açıkken ve kapalıyken üst bardaki health badge'i izle."],
    stepsEn: ["Observe top-bar health badge while API is up/down."],
    expectedTr: ["Duruma göre badge metni/tonu değişmeli."],
    expectedEn: ["Badge label/tone should change according to API state."],
  },
];

export default function AdminTestScenariosPage({ language }: { language: Language }) {
  const dict = DICTIONARIES[language];
  const isTr = language === "tr";

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>{dict.testScenarios.title}</h1>
          <p className="subtext">{dict.testScenarios.subtitle}</p>
        </div>
      </header>

      <section className="panel">
        <div className="alert">
          <strong>{dict.testScenarios.safetyTitle}</strong>
          <div>{dict.testScenarios.safetyText}</div>
        </div>
        <p className="panel-meta" style={{ marginTop: 10 }}>
          {dict.testScenarios.tipText}
        </p>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>{isTr ? "Öncelik" : "Priority"}</th>
                <th>{isTr ? "Senaryo" : "Scenario"}</th>
                <th>{isTr ? "Başlangıç Ekranı" : "Start Route"}</th>
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map((scenario) => (
                <tr key={scenario.id}>
                  <td>{scenario.id}</td>
                  <td>{scenario.priority}</td>
                  <td>{isTr ? scenario.titleTr : scenario.titleEn}</td>
                  <td><a href={`#${scenario.route}`}>{scenario.route}</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {SCENARIOS.map((scenario) => (
        <section className="panel" key={`detail-${scenario.id}`}>
          <div className="panel-header">
            <h2>{`${scenario.id} - ${isTr ? scenario.titleTr : scenario.titleEn}`}</h2>
          </div>
          <p className="panel-meta">
            <strong>{isTr ? "Ön Koşul" : "Precondition"}:</strong> {isTr ? scenario.preconditionTr : scenario.preconditionEn}
          </p>
          <div style={{ marginTop: 10 }}>
            <strong>{isTr ? "Adımlar" : "Steps"}</strong>
            <ol>
              {(isTr ? scenario.stepsTr : scenario.stepsEn).map((step, index) => (
                <li key={`${scenario.id}-step-${index}`}>{step}</li>
              ))}
            </ol>
          </div>
          <div style={{ marginTop: 10 }}>
            <strong>{isTr ? "Beklenen Sonuç" : "Expected"}</strong>
            <ul>
              {(isTr ? scenario.expectedTr : scenario.expectedEn).map((item, index) => (
                <li key={`${scenario.id}-expected-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
          <div style={{ marginTop: 8 }}>
            <a href={`#${scenario.route}`}>{isTr ? "İlgili ekrana git" : "Go to related page"}</a>
          </div>
        </section>
      ))}
    </div>
  );
}
