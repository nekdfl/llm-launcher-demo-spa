/** Состояние раздела деталей модели, пока данных нет: запрос идёт —
 * спиннер «Обновляю данные…»; запрос завершился ошибкой — «Нет данных» и
 * «Повторить». «Нет данных» не показывается, пока запрос не завершился. */
export function DetailLoadState({ loading, onRetry }: { loading: boolean; onRetry?: () => void }) {
  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-neutral-500 font-mono" data-testid="detail-loading">
        <span className="material-symbols-outlined text-base text-primary animate-spin">progress_activity</span>
        Обновляю данные…
      </p>
    );
  }
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-500 font-mono" data-testid="detail-unavailable">
      Нет данных
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          data-testid="detail-retry"
          className="px-3 py-1 border border-neutral-700 text-neutral-300 font-['Space_Grotesk'] text-[10px] font-bold uppercase hover:border-primary hover:text-primary"
        >
          Повторить
        </button>
      )}
    </div>
  );
}
