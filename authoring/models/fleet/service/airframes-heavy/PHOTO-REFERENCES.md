# 중량 헬기 외형 자료

세 기체의 형상은 게임의 좌석과 회전축 위치에 맞춰 Blender에서 다시 제작했다. 운영기관과 제작사 사진은 형상 확인에 사용했다. 재질의 도장, 정비 덮개, 리벳 무늬는 제작 스크립트에서 생성한다.

| 비행 기체 | 사진에서 대조한 부분 | 자료 |
|---|---|---|
| 해온 기린 · Sikorsky S-64 | 앞 조종실과 뒤를 보는 작업석, 열린 훅 공간 위 박스형 등뼈, 노출된 터빈과 바깥쪽으로 벌어진 주 착륙장치 | [Helicopter Express 운영 기체 사진](https://www.helicopterexpress.com/fleet) · [Erickson 측면·정면·평면도](https://ericksoninc.com/wp-content/uploads/2021/09/2021_S64-Spec_Flyer.pdf) |
| 해온 두솔 · Boeing CH-47 | 전후 로터 파일런의 높이 차, 뒤쪽 양옆 엔진, 기수 유리와 원형 객실창, 긴 연료 스폰슨과 뒤램프 | [Boeing 기체 사진](https://www.boeing.com/defense/military-rotorcraft/h-47-chinook) · [미 육군 CH-47F 사진 모음](https://www.army.mil/article/137584/) |
| 해온 해마루 · Westland Sea King HAR.3 | 보트 선체 하부와 스프레이 레일, 바깥쪽 부력체 아래 바퀴와 꼬리바퀴, 동체 위 엔진과 레이돔, 우현 구조문과 호이스트 | [영국 공군 박물관의 실제 구조기 사진](https://www.rafmuseum.org.uk/blog/sea-king-search-and-rescu/) |

재생성은 Blender 4.5에서 `blender -b -P models/fleet/service/airframes-heavy/build_heavy.py`로 실행한다. 편집용 `Heavy-Rescue-Airframes.blend`에는 기체별 컬렉션과 동체·창·착륙장치·회전부의 개별 부품이 들어 있다. 게임은 같은 부품을 재질별로 묶은 GLB를 읽는다.
