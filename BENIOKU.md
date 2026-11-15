# Vaktin Duası — site ve vakit deposu

Bu klasör bir GitHub deposunun içeriğidir. İki işe yarar:

1. **Gizlilik sayfası.** Google Play'in istediği herkese açık adres (`gizlilik/`).
2. **Diyanet vakitleri.** Diyanet erişiminiz açılınca vakitler her gün buraya indirilir (`vakitler/`); uygulama buradan okur.

## Kurulum (bir kez)

1. github.com'da **New repository** deyin. Ad: `vaktin-duasi`, görünürlük: **Public**. "Add a README" işaretlemeyin.
2. Açılan sayfada **uploading an existing file** bağlantısına tıklayın. Bu klasörün **içindeki her şeyi** (`.github` klasörü ve `.nojekyll` dosyası dâhil) sürükleyip bırakın, **Commit changes** deyin.
3. **Settings > Pages**: Source olarak **Deploy from a branch**, dal **main**, klasör **/ (root)** seçip **Save** deyin.
4. Bir iki dakika sonra site açılır: `https://KULLANICI-ADINIZ.github.io/vaktin-duasi/`
5. Gizlilik adresiniz: `https://KULLANICI-ADINIZ.github.io/vaktin-duasi/gizlilik/`
   Bunu Play Console > Uygulama içeriği > Gizlilik politikası alanına yazın.

## Diyanet erişimi açılınca

1. **Settings > Secrets and variables > Actions > New repository secret** ile iki gizli değer ekleyin:
   - `DIYANET_EMAIL`: Diyanet'in verdiği kullanıcı adı (e-posta)
   - `DIYANET_PASSWORD`: şifre
2. **Actions > Diyanet vakitlerini güncelle > Run workflow** ile ilk çalıştırmayı başlatın.
3. Bittiğinde `vakitler/durum.json` dosyasına bakın: `tamamlanan` ve `bekleyen` ilçe sayısını gösterir. Kota dolduysa kalanlar ertesi günkü otomatik çalışmada iner.

Şifreyi **yalnızca** Secrets alanına yazın. Bu depo herkese açıktır; şifreyi hiçbir dosyaya koymayın.

## Bilinmesi gerekenler

- Eşitleme her gün 04:17'de kendiliğinden çalışır. Gizli değerler tanımlı değilken hiçbir şey yapmaz, hata da vermez.
- GitHub, 60 gün hiç değişiklik olmayan depolarda zamanlanmış işleri durdurur. Durursa **Actions** sekmesinden yeniden etkinleştirin.
- Betik (`tools/diyanet-sync.mjs`) Diyanet'in yayımladığı örnek projedeki adres ve alan adlarına göre yazıldı ve yerel bir taklit sunucuyla sınandı; gerçek servisle ilk çalıştırmada küçük bir uyarlama gerekebilir.
- Diyanet'e verdiğiniz taahhüt formunda veriyi herkese açık bir adreste barındırmayı kısıtlayan bir madde varsa bu yapıyı kullanmadan önce haber verin.
- `index.html` içindeki "Yakında Google Play'de" yazısını uygulama yayımlanınca mağaza bağlantısıyla değiştirin.
