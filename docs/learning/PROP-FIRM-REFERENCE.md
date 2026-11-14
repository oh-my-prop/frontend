# 시중 프랍 트레이딩 업체 규칙 비교

조회일: 2026-11-14 · 대상: FTMO, Topstep, Apex Trader Funding, FundedNext, The5ers, FundingPips · 출처: 각 사 공식 사이트·헬프센터

> 각 사 규칙은 자주 바뀌고 **구매일 기준으로 다른 규칙이 적용된다.** 아래 값은 조회일의 공개 페이지를 요약한 것이며 우리 상품 설계의 비교 근거로만 쓴다. 검색 요약만으로 확인한 값은 `(2차)`, 공식 페이지끼리 어긋나는 값은 `(상충)`, 찾지 못한 값은 `미확인`으로 적었다.

## 1. 한눈에 보기

| 업체 | 시장 | 대표 상품 구조 | 계좌 성격 |
| --- | --- | --- | --- |
| FTMO | CFD(2026년 선물 상품 추가) | 2단계(10% → 5%), 1단계(10%) | 평가·펀딩 모두 데모 계좌 |
| Topstep | CME 계열 선물 | Trading Combine → Express Funded → Live | 펀딩 단계도 시뮬레이션으로 표기 |
| Apex Trader Funding | CME·CBOT·NYMEX·COMEX 선물 | 평가 → Performance Account | 펀딩 단계도 시뮬레이션으로 표기 |
| FundedNext | CFD | Stellar 2단계(8% → 5%) | 고지 문구 미확인 |
| The5ers | FX·금속·지수·원유·가상자산 CFD | High Stakes 2단계(10% → 5%) | 시뮬레이션 환경으로 고지 |
| FundingPips | CFD | 2단계 Standard(8% → 5%) | 고지 문구 미확인 |

## 2. 손실 한도 비교

| 업체 | 일일 손실 한도 | 기준과 리셋 | 성격 | 최대 손실 |
| --- | --- | --- | --- | --- |
| FTMO 2단계 | 5% | 자정(중부유럽 시각) 잔고에서 초기자본 5% 금액을 뺀 선, 에쿼티로 판정 | 하드(계정 종료) | 고정 10% |
| FTMO 1단계 | 3% | 동일 | 하드 | 종가 잔고 기준 추적형 10% |
| Topstep | $1,000~$3,000(계좌별) | 당일 순손익, 17:00 CT 리셋 | **소프트**(청산 후 당일 정지) | 종가 기준 추적형, 평가 단계는 시작 잔고에서 고정 |
| Apex | $500~$2,000(계좌별) | 장중 순손실, 18:00 ET 리셋 | 소프트 | 종가 기준 추적형, 펀딩 단계는 시작 잔고 + $100에서 고정 |
| FundedNext | 5% | 초기 잔고 기준 고정 금액, 서버 자정 리셋 | 하드 | 고정 10% |
| The5ers | 5% | 기준 `(상충)`: 전일 잔고·에쿼티 중 큰 값이라는 FAQ 있음 | 하드 | 10%, 유형 미명시 |
| FundingPips | 3% 또는 5%(선택) | 시작 잔고·시작 에쿼티 중 큰 값, 장중 에쿼티로 판정 | 하드 | 고정 10% |

**읽는 법**: CFD형은 "초기 잔고의 %"와 하드 브리치, 선물형은 "금액"과 소프트 정지 + 종가 기준 추적형이 많다. 이 차이는 시장 구조에서 온다. 선물은 거래소 세션이 있고 하루 단위로 정산(일일정산)하므로 "하루 손실"과 "종가"가 자연스러운 단위다. CFD는 24시간에 가깝게 거래되는 장외 상품이라 업체가 정한 서버 자정을 경계로 쓴다.

## 3. 목표·기간·활동

| 업체 | 수익 목표 | 최소 거래일 | 기간·무활동 |
| --- | --- | --- | --- |
| FTMO 2단계 | 10% → 5% | 4일(포지션을 연 날) | 기간 제한 없음 |
| Topstep | $3,000~$9,000 | 2일 | 펀딩 단계 30일 무거래 시 종료 가능 |
| Apex | $1,500~$9,000 | 없음 | 평가 30일 기한, 펀딩 단계는 30일 중 $50 이상 수익일 2일 필요 |
| FundedNext | 8% → 5% | 단계별 5일 | 기간 제한 없음 |
| The5ers | 10% → 5% | 수익일 3일(초기 잔고 0.5% 이상) | 30일 무활동 시 만료 |
| FundingPips | 8% → 5% | 3일(일일 3% 선택 시 없음) | 30일간 청산 거래 없으면 브리치 |

## 4. 일관성 규칙

| 업체 | 공식 | 적용 위치 | 초과 시 |
| --- | --- | --- | --- |
| FTMO 1단계 | 최고일 ≤ 총수익의 50% | 평가 | 위반 아님. 비율을 맞출 때까지 계속 거래 |
| Topstep | 최고일 ≤ 총수익의 55% `(상충: 50%로 적힌 페이지 있음)` / 펀딩 40% | 평가 / 지급 | 평가는 목표가 올라간다 |
| Apex | 단일 수익일 비중 50% 미만 | 지급 | 출금 요청만 막힌다 |
| FundedNext | 최고일 ≤ 40% | On-Demand 지급 경로 | 지급 보류 |
| FundingPips | 단일일 ≤ 35% | On-Demand 지급 경로 | 지급 보류 |

**공통 수식**: `최고 수익일 ÷ 기간 총수익 ≤ 상한`. 결과 처리는 세 가지(계속 거래, 목표 상향, 지급 보류)이지만 수학적으로는 같다. "목표 상향"은 `필요 총수익 = 최고일 ÷ 상한`을 보여 주는 표현일 뿐이다. 우리 엔진은 이 값을 `requiredProfitCents`로 돌려준다.

**왜 이런 규칙이 있나**: 하루의 큰 수익(운, 과도한 레버리지, 뉴스 도박)으로 통과하는 것을 막고, 반복 가능한 성과를 요구한다. 증권업으로 치면 "수익의 질"을 보는 성과 평가다.

## 5. 보상 지급

| 업체 | 분배율 | 시점·주기 | 조건·상한 |
| --- | --- | --- | --- |
| FTMO | 2단계 80%(조건 충족 시 90%), 1단계 90% | 첫 거래 후 14일째부터 | 포지션 전부 청산, 첫 보상 시 2단계 수수료 환급 |
| Topstep | 90% | 수익일 5일($150 이상) 경로 또는 3거래일 + 40% 일관성 경로 | 1회 잔고 50%까지, 계좌별 상한, 최소 $125 |
| Apex | 100% | 적격일 5일, 최단 주 1회 | 최소 $500, 드로다운 + $100 위 금액만, 회차별 상한, 최대 6회 |
| FundedNext | 80%(21일 주기) / 60%(수익일 방식) / 90%(On-Demand) | 첫 주기 21일 후 14일 | 첫 보상 시 수수료 환급 |
| The5ers | 80%에서 시작해 100%까지 상향 | 격주 | 최소 $150, 계좌별 상한 |
| FundingPips | 60%(주간) / 80%(격주) / 100%(On-Demand) | 주기별 | 최소 계좌 사이즈의 1% |

## 6. 거래 제한과 금지 행위

| 범주 | 사례 | 증권업의 원형 |
| --- | --- | --- |
| 뉴스 전후 제한 | 지정 지표 발표 ±2~5분 체결 금지 또는 수익 불인정 | 변동성 급증 구간의 주문 통제 |
| 보유 시간 제한 | 선물형 장 마감 전 청산, CFD 펀딩 단계 주말 보유 금지 | 오버나이트 위험 한도 |
| 포지션 크기 | 계약 수 상한, 잔고 구간별 확대(스케일링) | 트레이더별 포지션 한도 |
| 시세·체결 악용 | 지연 시세 차익, 피드 오류 악용, 비현실적 시뮬레이션 체결 노리기 | 시세 오류 거래 취소 정책 |
| 계정 간 조작 | 다계정 반대 포지션 헤지, 타인과의 카피, 계정 대리 운용 | 통정매매·가장매매 감시 |
| 수익 분산 조작 | 하나의 아이디어를 여러 날로 나눠 수익일 늘리기 | 성과 지표 조작 |

## 7. 2024–2026 주요 사건

| 시기 | 사건 | 시사점 |
| --- | --- | --- |
| 2024-02 | MT4/MT5 공급사가 프랍 업체 대상 라이선스를 회수, 일부 업체 플랫폼 이전 | 거래 플랫폼 의존은 사업 연속성 위험 → 체결 계층을 직접 소유 |
| 2024-05 | 한 CFD 프랍 업체가 지급 불능으로 폐업 | 지급 준비금과 노출 상한이 신뢰의 핵심 |
| 2025-05 | 미국 CFTC의 MyForexFunds 소송이 CFTC 측 잘못으로 영구 기각(본안 판단 없음) | 규제 불확실성은 해소되지 않았다 |
| 2025-12 | FTMO가 OANDA 인수 완료 | 프랍 업체의 브로커리지(위탁매매) 업 진출 |
| 2026-03 | Apex가 규칙 전면 개편, 이전 구매분은 기존 규칙 유지 | 규칙 버전 고정의 필요성 |
| 2026 | FundingPips 10% 목표 옵션 폐지, FTMO 1단계 일관성 공식 변경 | 규칙 변경은 상시적 |

## 8. 우리 설계에 반영한 것

- 규칙 엔진에 금액 기준 한도, 소프트 일일 정지, 추적형 고정 오프셋, 최소 수익일, 장 마감 청산을 추가했다(`oh-my-prop/backend`의 `src/rules/engine.js`).
- 자체 상품 명세 3종을 만들었다(`oh-my-prop/data`의 `programs/`). 업체 상품을 복제하지 않고 규칙의 형태만 참고했다. 대응표는 `oh-my-prop/data`의 `docs/RULE-PATTERNS.md`.
- 아직 반영하지 못한 것: 뉴스 시간대 규칙, 주말·휴장 캘린더, 스케일링 구간표, 보상 요청 상한, 0.25 같은 틱 단위.

## 출처

- FTMO: [Trading Objectives](https://ftmo.com/en/trading-objectives/), [Scaling Plan](https://ftmo.com/en/scaling-plan/), [Forbidden Trading Practices](https://ftmo.com/en/forbidden-trading-practices/), [뉴스 거래 FAQ](https://ftmo.com/en/faq/can-i-trade-news/), [보상 FAQ](https://ftmo.com/en/faq/how-do-i-withdraw-my-profits/)
- Topstep: [Trading Combine Rules](https://help.topstep.com/en/articles/8284208-trading-combine-rules), [Daily Loss Limit](https://help.topstep.com/en/articles/10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account), [Maximum Loss Limit](https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit), [Payout Policy](https://help.topstep.com/en/articles/8284233-topstep-payout-policy), [Prohibited Strategies](https://help.topstep.com/en/articles/10305426-prohibited-trading-strategies-at-topstep)
- Apex: [EOD Evaluations](https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-evaluations/), [EOD Drawdown](https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-drawdown-explained/), [EOD Payouts](https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/), [Prohibited Activities](https://apextraderfunding.com/help-center/getting-started/prohibited-activities/)
- FundedNext: [Stellar 2-Step](https://help.fundednext.com/en/articles/17255124-stellar-2-step-challenge), [일일 손실 계산](https://help.fundednext.com/en/articles/8019811-how-can-i-calculate-the-daily-loss-limit)
- The5ers: [High Stakes](https://the5ers.com/high-stakes/), [Payout Policy](https://the5ers.com/faqs/payout-policy-and-hub-credit-in-the-high-stakes-program/), [Prohibited Practices](https://the5ers.com/faqs/prohibited-trading-practices/)
- FundingPips: [2-Step Standard](https://help.fundingpips.com/hc/en-us/articles/34501809112081-2-Step-Standard), [Trading Conduct](https://help.fundingpips.com/hc/en-us/articles/34505029138449-Trading-Conduct-and-Security-Standards)
- 사건: [MetaQuotes 라이선스 회수](https://fxnewsgroup.com/forex-news/retail-forex/exclusive-prop-trading-firm-true-forex-funds-shut-down-by-metaquotes-move/), [True Forex Funds 폐업](https://www.tradingview.com/news/financemagnates:d740598bd094b:0-prop-trading-true-forex-funds-shuts-down/), [MyForexFunds 소송 기각](https://www.financemagnates.com/forex/my-forex-funds-parent-defeats-cftc-in-court-as-judge-imposes-sanctions/), [FTMO의 OANDA 인수](https://www.fxstreet.com/press-releases/ftmo-building-global-trading-powerhouse-completes-acquisition-of-oanda-from-cvc-202512020741)
