# 🌿 Treasury DAO System

Bu proje, **DAO tabanlı hazine yönetimi** ve **karbon kredisi alımı** için tasarlanmış akıllı sözleşmeleri içerir.  
İki ana bileşen vardır:

- **TreasuryContract** → Hazine yönetimi, yatırımlar ve acil durum çekim mekanizmaları
- **ValidatorDAO** → Yönetişim, teklif oylamaları ve karbon kredisi opsiyon yönetimi

---

## ✅ Test Sonuçları

Tüm testler başarıyla geçti:

Treasury DAO System
TreasuryContract
✔ Should allow deposits
✔ Should allow deposits via receive function
✔ Should execute carbon credit purchase when called by DAO
✔ Should not allow non-DAO to execute carbon credit purchase
✔ Should handle emergency withdrawal with delay
✔ Should allow cancelling emergency withdrawal
ValidatorDAO
✔ Should allow validators to create proposals
✔ Should not allow creating proposals exceeding treasury balance
✔ Should not allow non-validators to create proposals
✔ Should allow validators to vote on proposals
✔ Should not allow double voting
✔ Should execute successful proposals with quorum
✔ Should not execute proposals without quorum
✔ Should not execute failed proposals
✔ Should not execute proposals before voting period ends
✔ Should add and remove validators properly
✔ Should not allow removing the last validator
✔ Should add and manage carbon credit options
✔ Should return active carbon credit options
✔ Should allow setting governance parameters
✔ Should get proposal voting statistics
Integration Tests
✔ Should complete full workflow: deposit → proposal → vote → execute → purchase
✔ Should handle multiple proposals and purchases


---

## ⚙️ Solidity ve Ağ Konfigürasyonu

| Özellik            | Değer             |
|--------------------|------------------|
| **Solidity**       | `0.8.28` |
| **Optimizer**      | `false` |
| **Runs**           | `200` |
| **viaIR**          | `false` |
| **Blok Gas Limiti** | `30,000,000` |
| **Toolchain**      | `Hardhat` |

---

## ⛽ Gas Kullanımı (Ortalama)

### TreasuryContract
- `deposit` → **47,508**
- `executeCarbonCreditPurchase` → **222,092**
- `requestEmergencyWithdraw` → **52,511**
- `executeEmergencyWithdraw` → **42,606**
- `cancelEmergencyWithdraw` → **29,061**
- `updateDAOContract` → **58,913**

### ValidatorDAO
- `createProposal` → **260,042**
- `executeProposal` → **218,286**
- `vote` → **86,781**
- `addValidator` → **83,583**
- `removeValidator` → **35,151**
- `addCarbonCreditOption` → **175,997**
- `deactivateCarbonCreditOption` → **28,051**
- `setGovernance Params` → ~**29,200**

---

## 📦 Dağıtım Maliyetleri

| Kontrat           | Ortalama Gas | % Blok Limiti |
|-------------------|--------------|---------------|
| TreasuryContract  | **2,903,477** | 9.7 % |
| ValidatorDAO      | **3,799,454** | 12.7 % |

---

## 🚀 Çalıştırma

Projeyi test etmek için:

```bash
npm install
npx hardhat test
