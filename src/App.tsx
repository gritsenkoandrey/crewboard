import { useEffect, useState } from "react";
import { getDataDir, pickFolder, setDataDir, type DataDirInfo } from "./api";

export default function App() {
  const [info, setInfo] = useState<DataDirInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDataDir().then(setInfo, (e) => setError(String(e)));
  }, []);

  async function chooseFolder() {
    setError(null);
    const path = await pickFolder(info?.path ?? undefined);
    if (!path) return;
    try {
      setInfo(await setDataDir(path));
    } catch (e) {
      setError(String(e));
    }
  }

  if (!info) {
    return <div className="center muted">{error ?? "Загрузка…"}</div>;
  }

  if (!info.path || info.missing) {
    return <SetupScreen info={info} error={error} onChoose={chooseFolder} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="logo">Task Track</h1>
        <div className="data-dir" title={info.path}>
          <span className="muted">Данные:</span> {info.path}
        </div>
        <button className="btn" onClick={chooseFolder}>
          Сменить папку
        </button>
      </header>
      {error && <div className="error-bar">{error}</div>}
      <main className="content">
        <div className="empty">
          <p>Проектов пока нет.</p>
          <p className="muted">Список проектов появится на следующем этапе.</p>
        </div>
      </main>
    </div>
  );
}

function SetupScreen({ info, error, onChoose }: { info: DataDirInfo; error: string | null; onChoose: () => void }) {
  return (
    <div className="center">
      <div className="setup">
        <h1>Task Track</h1>
        {info.missing ? (
          <p className="warning">
            Папка с данными недоступна:
            <br />
            <code>{info.path}</code>
            <br />
            Подключите диск или выберите другую папку.
          </p>
        ) : (
          <p>
            Выберите папку, где будут храниться проекты. Лучше не на диске C: — тогда данные переживут
            переустановку Windows. Можно выбрать папку в OneDrive или Dropbox для бэкапа.
          </p>
        )}
        <p className="muted">Если папка уже использовалась раньше, все проекты в ней подхватятся.</p>
        <button className="btn primary" onClick={onChoose}>
          Выбрать папку
        </button>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
