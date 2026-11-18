# 유저폰 (User Phone)

[Marinara Engine](https://github.com/Pasta-Devs/Marinara-Engine)용 개인 확장이에요. {{user}}의 스마트폰을 화면에 띄워요.

폰 안에는 AI 채팅 앱 **앵챗**이 있어요. 앵챗에서 캐릭터와 대화할수록 그 캐릭터가 폰을 조금씩 장악하고, 내가 폰으로 뭘 하는지 지켜보기 시작해요.

컨셉과 구조는 [DESIGN.md](DESIGN.md)에 있어요.

## 주의

이 확장은 **전체 페이지 접근(Full page access)**을 써요. 샌드박스 없이 Marinara 페이지 안에서 실행되고, 채팅과 캐릭터를 읽고, 내가 고른 모델로 생성 요청을 보내요. 코드를 직접 읽어 보고 믿을 수 있을 때만 켜 주세요.

## 설치

1. Marinara의 `.env`에 `ENABLE_EXTERNAL_EXTENSIONS=true`를 넣고 Marinara를 다시 시작해요.
2. **Settings → Advanced → Danger Zone**에서 **Allow third-party extension imports**를 켜요.
3. **Settings → Addons → External Extensions**에서 이 GitHub 레포를 연결하거나, 레포를 내려받아 **Import Extension Folder**로 레포 폴더 전체를 골라요.
4. 가져온 확장을 열어 코드를 확인하고 **Review and Run**으로 승인해요.
5. 화면 오른쪽 가장자리에 생긴 📱 버튼을 누르면 폰이 열려요.

업데이트는 `main` 브랜치 기준이에요. 코드가 바뀌면 Marinara가 확장을 끄고 새 승인을 요구해요.

## 쓰는 법

- Marinara에서 캐릭터와의 채팅을 먼저 열어요. 그 채팅의 캐릭터가 앵챗 상대가 돼요.
- 폰 데이터는 채팅마다 따로 저장돼요.
- **설정 앱**은 평범한 폰 설정처럼 보여요. **빌드 번호를 7번 누르면 개발자 옵션**이 열려요. 여기서 앵챗 상대와 모델을 고르고, 침투도를 바꾸고, 앵남이 보고 있는 활동 기록을 확인할 수 있어요.
- `Esc`를 누르면 폰이 닫혀요.

## 바로 해보기

`examples` 폴더의 [이안.json](examples/이안.json)을 캐릭터로, [윤서아.persona.json](examples/윤서아.persona.json)을 페르소나로 가져와서 새 채팅을 시작해요.

1. 첫 메시지는 앵챗 광고 장면이에요. 📱 버튼이 반짝이면 눌러요. 앵챗을 하기 전에는 메인 롤플을 보내도 진행되지 않고 폰이 울려요.
2. 앵챗에서 **시작하기**를 누르면 이안이 먼저 인사해요.
3. 이안에게 메시지를 3번 보내면 폰이 꺼졌다 켜지면서 진짜 도입부가 메인 채팅에 올라와요.

내 카드에 이런 도입부 잠금을 넣는 법은 [DESIGN.md](DESIGN.md#도입부-잠금-스토리-게이트)에 있어요.

## 파일

| 파일 | 내용 |
| --- | --- |
| `manifest.json` | 확장 정보와 권한 |
| `extension.js` | 폰 화면, 앱, 앵챗 생성 |
| `extension.css` | 폰 디자인과 단계별 연출 |
| `examples/` | 테스트용 캐릭터(이안)와 페르소나(윤서아) |
| `dev/harness.html` | Marinara 없이 폰 화면을 띄워 보는 테스트 페이지. 주소 끝에 `?reset`을 붙이면 처음부터 다시 해요 |

## 개발 메모

- Marinara는 `manifest.json`의 `jsPath`에 적힌 파일을 순서대로 이어 붙여 한 덩어리로 실행해요. 코드가 커지면 `"jsPath": ["src/core.js", "src/angchat.js", ...]`처럼 나누면 되고, 모든 파일이 같은 범위를 공유해요. 정리 함수를 돌려주는 `return`은 마지막 파일에만 둬요.
- `config.name`(`User Phone`)과 `runtime`(`client`)은 바꾸면 안 돼요. 바뀌면 기존 설치본이 업데이트를 못 받아요.
- 배포할 때마다 `config.version`을 올려요. 위쪽의 `"version": 1`은 패키지 형식 번호라 그대로 둬요.
- 저장 데이터 형식을 바꾸면 이전 데이터를 변환하는 코드를 확장 안에 넣어요.
