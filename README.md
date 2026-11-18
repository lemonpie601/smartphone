# 유저폰 (User Phone)

[Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine)용 개인 확장이에요. {{user}}의 스마트폰을 화면에 띄워요.

폰 안에는 AI 채팅 앱 **앵챗**이 있어요. 앵챗에서 캐릭터와 대화할수록 그 캐릭터가 폰을 조금씩 장악하고, 내가 폰으로 뭘 하는지 지켜보기 시작해요.

컨셉과 구조는 [DESIGN.md](DESIGN.md)에 있어요.

## 주의

이 확장은 **전체 페이지 접근(Full page access)**을 써요. 샌드박스 없이 Marinara 페이지 안에서 실행되고, 채팅과 캐릭터를 읽고, 내가 고른 모델로 생성 요청을 보내요. 코드를 직접 읽어 보고 믿을 수 있을 때만 켜 주세요.

## 설치

1. Marinara의 `.env`에 `ENABLE_EXTERNAL_EXTENSIONS=true`를 넣고 Marinara를 다시 시작해요.
2. **Settings → Advanced → Danger Zone**에서 **Allow third-party extension imports**를 켜요.
3. **Settings → Addons → External Extensions**에서 **Import Extension Folder**를 누르고 이 레포의 `extension` 폴더를 골라요.
4. 가져온 확장을 열어 코드를 확인하고 **Review and Run**으로 승인해요.
5. 화면 오른쪽 가장자리에 생긴 📱 버튼을 누르면 폰이 열려요.

업데이트할 때는 같은 폴더를 다시 가져오고 다시 승인하면 돼요. 코드가 바뀌면 Marinara가 확장을 끄고 새 승인을 요구해요.

## 쓰는 법

- Marinara에서 캐릭터와의 채팅을 먼저 열어요. 그 채팅의 캐릭터가 앵챗 상대가 돼요.
- 폰 데이터는 채팅마다 따로 저장돼요.
- **설정 앱:** 앵챗 상대와 모델을 고르고, 침투도를 바꾸고, 앵남이 보고 있는 활동 기록을 확인할 수 있어요.
- `Esc`를 누르면 폰이 닫혀요.

## 파일

| 파일 | 내용 |
| --- | --- |
| `extension/manifest.json` | 확장 정보와 권한 |
| `extension/extension.js` | 폰 화면, 앱, 앵챗 생성 |
| `extension/extension.css` | 폰 디자인과 단계별 연출 |
| `dev/harness.html` | Marinara 없이 폰 화면을 띄워 보는 테스트 페이지 |
