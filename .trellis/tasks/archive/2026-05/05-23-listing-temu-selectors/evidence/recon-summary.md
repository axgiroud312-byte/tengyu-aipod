# Temu PopTemu selector reconnaissance

Profile: seq=2 name=1111 id=02b6125939804e04bdf61c75da386c0a
Endpoint: http://127.0.0.1:58791

## temu-clothing
- URL: https://www.dianxiaomi.com/web/popTemu/edit?id=128935194843933515
- Title: 店小秘--编辑Temu半托管产品
- Relevant DOM snapshot bytes: 44168
- Screenshot: `temu-clothing.png`
- Controls: `temu-clothing.controls.json`
- Text: `temu-clothing.txt`

## temu-general
- URL: https://www.dianxiaomi.com/web/popTemu/edit?id=128935194833519551
- Title: 店小秘--编辑Temu半托管产品
- Relevant DOM snapshot bytes: 45069
- Screenshot: `temu-general.png`
- Controls: `temu-general.controls.json`
- Text: `temu-general.txt`

Observed stable anchors:
- Page title: 店小秘--编辑Temu半托管产品
- Root page copy: Temu半托管产品>创建产品
- Product section: #productProductInfo
- Variant attributes section: #skuAttrsInfo
- Variant/SKU section: #skuDataInfo
- Description section: #describeInfo
- Shipping section: #shipmentInfo
- Hidden local upload input: #localFileUploadInp

Raw full-page HTML was generated during reconnaissance and then discarded to avoid committing multi-megabyte noise; the committed DOM snapshots keep the relevant form sections.
