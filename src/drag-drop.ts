import { App, TFile, Notice } from 'obsidian';
import type { BasesEntry } from 'obsidian';

/**
 * Types for drag operations
 */
export type DragType = 'column' | 'card';

export interface DragState {
	type: DragType;
	sourceColumnName: string;
	sourceIndex: number;
	element: HTMLElement;
	// For cards
	entry?: BasesEntry;
	filePath?: string;
}

export interface DropTarget {
	type: 'column' | 'card-zone';
	columnName: string;
	insertIndex: number;
	element: HTMLElement;
}

export interface DragDropCallbacks {
	onColumnReorder: (newOrder: string[]) => void;
	onCardMoveToColumn: (file: TFile, newColumnValue: string) => Promise<void>;
	onCardReorder: (file: TFile, targetColumnName: string, targetIndex: number) => Promise<void>;
	getColumnNames: () => string[];
	getGroupByProperty: () => string | null;
	getSortProperty: () => string | null;
}

/**
 * Manages drag and drop operations for the kanban board
 */
export class DragDropManager {
	private app: App;
	private callbacks: DragDropCallbacks;
	private dragState: DragState | null = null;
	private dropIndicator: HTMLElement | null = null;
	private boardEl: HTMLElement | null = null;

	constructor(app: App, callbacks: DragDropCallbacks) {
		this.app = app;
		this.callbacks = callbacks;
	}

	/**
	 * Initialize drag and drop on the board
	 */
	public initBoard(boardEl: HTMLElement): void {
		this.boardEl = boardEl;
		this.createDropIndicator();
	}

	/**
	 * Clean up when view is unloaded
	 */
	public destroy(): void {
		this.dropIndicator?.remove();
		this.dropIndicator = null;
		this.boardEl = null;
		this.dragState = null;
	}

	/**
	 * Create the drop indicator element
	 */
	private createDropIndicator(): void {
		this.dropIndicator = document.createElement('div');
		this.dropIndicator.className = 'bases-kanban-drop-indicator';
	}

	/**
	 * Make a column draggable
	 */
	public makeColumnDraggable(
		columnEl: HTMLElement,
		columnName: string,
		index: number
	): void {
		const headerEl = columnEl.querySelector('.bases-kanban-column-header') as HTMLElement;
		if (!headerEl) return;

		// Make the header the drag handle
		headerEl.setAttribute('draggable', 'true');
		headerEl.classList.add('bases-kanban-draggable');

		headerEl.addEventListener('dragstart', (e) => this.handleColumnDragStart(e, columnEl, columnName, index));
		headerEl.addEventListener('dragend', (e) => this.handleDragEnd(e));

		// Column as drop target
		columnEl.addEventListener('dragover', (e) => this.handleColumnDragOver(e, columnEl, columnName, index));
		columnEl.addEventListener('dragleave', (e) => this.handleDragLeave(e, columnEl));
		columnEl.addEventListener('drop', (e) => this.handleColumnDrop(e, columnName, index));
	}

	/**
	 * Make a card draggable
	 */
	public makeCardDraggable(
		cardEl: HTMLElement,
		entry: BasesEntry,
		columnName: string,
		cardIndex: number
	): void {
		cardEl.setAttribute('draggable', 'true');
		cardEl.classList.add('bases-kanban-draggable');

		cardEl.addEventListener('dragstart', (e) => this.handleCardDragStart(e, cardEl, entry, columnName, cardIndex));
		cardEl.addEventListener('dragend', (e) => this.handleDragEnd(e));
		cardEl.addEventListener('dragover', (e) => this.handleCardDragOver(e, cardEl, columnName, cardIndex));
		cardEl.addEventListener('drop', (e) => this.handleCardDrop(e, columnName, cardIndex));
	}

	/**
	 * Set up a cards container as a drop zone
	 */
	public setupCardsDropZone(cardsEl: HTMLElement, columnName: string): void {
		cardsEl.addEventListener('dragover', (e) => this.handleCardsContainerDragOver(e, cardsEl, columnName));
		cardsEl.addEventListener('dragleave', (e) => this.handleDragLeave(e, cardsEl));
		cardsEl.addEventListener('drop', (e) => this.handleCardsContainerDrop(e, columnName));
	}

	// ==================== Column Drag Handlers ====================

	private handleColumnDragStart(
		e: DragEvent,
		columnEl: HTMLElement,
		columnName: string,
		index: number
	): void {
		if (!e.dataTransfer) return;

		this.dragState = {
			type: 'column',
			sourceColumnName: columnName,
			sourceIndex: index,
			element: columnEl,
		};

		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', `column:${columnName}`);

		// Add dragging class after a small delay to not affect the drag image
		requestAnimationFrame(() => {
			columnEl.classList.add('bases-kanban-dragging');
		});
	}

	private handleColumnDragOver(
		e: DragEvent,
		columnEl: HTMLElement,
		columnName: string,
		_index: number
	): void {
		if (!this.dragState || this.dragState.type !== 'column') return;
		if (this.dragState.sourceColumnName === columnName) return;

		e.preventDefault();
		e.stopPropagation();

		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}

		// Determine if we should show indicator on left or right
		const rect = columnEl.getBoundingClientRect();
		const midX = rect.left + rect.width / 2;
		const isLeft = e.clientX < midX;

		this.showColumnDropIndicator(columnEl, isLeft);
		columnEl.classList.add('bases-kanban-drag-over');
	}

	private handleColumnDrop(
		e: DragEvent,
		targetColumnName: string,
		_targetIndex: number
	): void {
		e.preventDefault();
		e.stopPropagation();

		if (!this.dragState || this.dragState.type !== 'column') return;
		if (this.dragState.sourceColumnName === targetColumnName) return;

		// Get current column order
		const columnNames = this.callbacks.getColumnNames();
		const sourceIndex = columnNames.indexOf(this.dragState.sourceColumnName);
		
		if (sourceIndex === -1) return;

		// Determine actual target index based on drop position
		const targetEl = e.currentTarget as HTMLElement;
		const rect = targetEl.getBoundingClientRect();
		const isLeft = e.clientX < rect.left + rect.width / 2;
		
		let newTargetIndex = columnNames.indexOf(targetColumnName);
		if (!isLeft && newTargetIndex < columnNames.length) {
			newTargetIndex++;
		}

		// Reorder array
		const newOrder = [...columnNames];
		const [removed] = newOrder.splice(sourceIndex, 1);
		
		// Adjust target index if source was before target
		if (sourceIndex < newTargetIndex) {
			newTargetIndex--;
		}
		
		newOrder.splice(newTargetIndex, 0, removed);

		this.callbacks.onColumnReorder(newOrder);
		this.clearDragState();
	}

	// ==================== Card Drag Handlers ====================

	private handleCardDragStart(
		e: DragEvent,
		cardEl: HTMLElement,
		entry: BasesEntry,
		columnName: string,
		cardIndex: number
	): void {
		if (!e.dataTransfer) return;

		// Stop propagation to prevent column drag
		e.stopPropagation();

		this.dragState = {
			type: 'card',
			sourceColumnName: columnName,
			sourceIndex: cardIndex,
			element: cardEl,
			entry: entry,
			filePath: entry.file.path,
		};

		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', `card:${entry.file.path}`);

		requestAnimationFrame(() => {
			cardEl.classList.add('bases-kanban-dragging');
		});
	}

	private handleCardDragOver(
		e: DragEvent,
		cardEl: HTMLElement,
		_columnName: string,
		_cardIndex: number
	): void {
		if (!this.dragState || this.dragState.type !== 'card') return;
		
		e.preventDefault();
		e.stopPropagation();

		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}

		// Determine if we should show indicator above or below
		const rect = cardEl.getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		const isAbove = e.clientY < midY;

		this.showCardDropIndicator(cardEl, isAbove);
	}

	private handleCardDrop(
		e: DragEvent,
		targetColumnName: string,
		targetCardIndex: number
	): void {
		e.preventDefault();
		e.stopPropagation();

		if (!this.dragState || this.dragState.type !== 'card') return;

		const { entry, sourceColumnName, sourceIndex } = this.dragState;
		if (!entry) return;

		// Determine actual insert position
		const targetEl = e.currentTarget as HTMLElement;
		const rect = targetEl.getBoundingClientRect();
		const isAbove = e.clientY < rect.top + rect.height / 2;
		
		let insertIndex = targetCardIndex;
		if (!isAbove) {
			insertIndex++;
		}

		// Handle the drop
		void this.processCardDrop(entry, sourceColumnName, targetColumnName, sourceIndex, insertIndex);
		this.clearDragState();
	}

	private handleCardsContainerDragOver(
		e: DragEvent,
		cardsEl: HTMLElement,
		_columnName: string
	): void {
		if (!this.dragState || this.dragState.type !== 'card') return;

		e.preventDefault();

		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}

		// Only show drop zone if not over a card
		const target = e.target as HTMLElement;
		if (!target.closest('.bases-kanban-card')) {
			cardsEl.classList.add('bases-kanban-drop-zone-active');
			this.showCardDropIndicatorAtEnd(cardsEl);
		}
	}

	private handleCardsContainerDrop(
		e: DragEvent,
		targetColumnName: string
	): void {
		e.preventDefault();

		if (!this.dragState || this.dragState.type !== 'card') return;

		const { entry, sourceColumnName, sourceIndex } = this.dragState;
		if (!entry) return;

		// Get number of cards in target column to insert at end
		const cardsEl = e.currentTarget as HTMLElement;
		const cardCount = cardsEl.querySelectorAll('.bases-kanban-card').length;

		void this.processCardDrop(entry, sourceColumnName, targetColumnName, sourceIndex, cardCount);
		this.clearDragState();
	}

	// ==================== Drop Processing ====================

	private async processCardDrop(
		entry: BasesEntry,
		sourceColumnName: string,
		targetColumnName: string,
		sourceIndex: number,
		targetIndex: number
	): Promise<void> {
		const groupByProperty = this.callbacks.getGroupByProperty();
		const sortProperty = this.callbacks.getSortProperty();

		// Moving to different column - update the groupBy property
		if (sourceColumnName !== targetColumnName) {
			if (!groupByProperty) {
				new Notice('Could not detect the group by property for drag and drop');
				return;
			}

			// Handle "(No value)" column
			const newValue = targetColumnName === '(No value)' ? '' : targetColumnName;
			await this.callbacks.onCardMoveToColumn(entry.file, newValue);

			// Also update sort property so the card lands at the correct position
			if (sortProperty) {
				await this.callbacks.onCardReorder(entry.file, targetColumnName, targetIndex);
			}
		}
		// Reordering within same column - update sort property if configured
		else if (sortProperty && sourceIndex !== targetIndex) {
			// Adjust target index if dragging down (source card will be removed first)
			let adjustedTargetIndex = targetIndex;
			if (sourceIndex < targetIndex) {
				adjustedTargetIndex--;
			}
			
			// Let the view calculate the actual sort value based on neighbors
			await this.callbacks.onCardReorder(entry.file, targetColumnName, adjustedTargetIndex);
		}
	}

	// ==================== Visual Indicators ====================

	private showColumnDropIndicator(columnEl: HTMLElement, isLeft: boolean): void {
		if (!this.dropIndicator || !this.boardEl) return;

		this.dropIndicator.className = 'bases-kanban-drop-indicator bases-kanban-drop-indicator-column is-visible';

		const rect = columnEl.getBoundingClientRect();
		const boardRect = this.boardEl.getBoundingClientRect();

		const leftPos = isLeft
			? `${rect.left - boardRect.left - 4}px`
			: `${rect.right - boardRect.left - 4}px`;

		this.dropIndicator.setCssProps({
			'--indicator-height': `${rect.height}px`,
			'--indicator-top': `${rect.top - boardRect.top}px`,
			'--indicator-left': leftPos,
		});

		this.boardEl.appendChild(this.dropIndicator);
	}

	private showCardDropIndicator(cardEl: HTMLElement, isAbove: boolean): void {
		if (!this.dropIndicator) return;

		this.dropIndicator.className = 'bases-kanban-drop-indicator bases-kanban-drop-indicator-card is-visible';

		const rect = cardEl.getBoundingClientRect();
		const parentRect = cardEl.parentElement?.getBoundingClientRect();
		if (!parentRect) return;

		const topPos = isAbove
			? `${rect.top - parentRect.top - 4}px`
			: `${rect.bottom - parentRect.top}px`;

		this.dropIndicator.setCssProps({
			'--indicator-width': `${rect.width}px`,
			'--indicator-left': `${rect.left - parentRect.left}px`,
			'--indicator-top': topPos,
		});

		cardEl.parentElement?.appendChild(this.dropIndicator);
	}

	private showCardDropIndicatorAtEnd(cardsEl: HTMLElement): void {
		if (!this.dropIndicator) return;

		this.dropIndicator.className = 'bases-kanban-drop-indicator bases-kanban-drop-indicator-card is-visible';

		const rect = cardsEl.getBoundingClientRect();
		const lastCard = cardsEl.querySelector('.bases-kanban-card:last-child');
		
		let topPos = '8px';
		if (lastCard) {
			const lastCardRect = lastCard.getBoundingClientRect();
			topPos = `${lastCardRect.bottom - rect.top + 4}px`;
		}

		this.dropIndicator.setCssProps({
			'--indicator-width': 'calc(100% - 16px)',
			'--indicator-left': '8px',
			'--indicator-top': topPos,
		});

		cardsEl.appendChild(this.dropIndicator);
	}

	private hideDropIndicator(): void {
		if (this.dropIndicator) {
			this.dropIndicator.removeClass('is-visible');
		}
	}

	// ==================== Common Handlers ====================

	private handleDragEnd(_e: DragEvent): void {
		this.clearDragState();
	}

	private handleDragLeave(e: DragEvent, element: HTMLElement): void {
		// Only handle if actually leaving the element (not entering a child)
		const relatedTarget = e.relatedTarget as HTMLElement | null;
		if (relatedTarget && element.contains(relatedTarget)) {
			return;
		}

		element.classList.remove('bases-kanban-drag-over');
		element.classList.remove('bases-kanban-drop-zone-active');
		this.hideDropIndicator();
	}

	private clearDragState(): void {
		if (this.dragState?.element) {
			this.dragState.element.classList.remove('bases-kanban-dragging');
		}

		// Clear all drag-related classes from board
		if (this.boardEl) {
			this.boardEl.querySelectorAll('.bases-kanban-drag-over').forEach(el => {
				el.classList.remove('bases-kanban-drag-over');
			});
			this.boardEl.querySelectorAll('.bases-kanban-drop-zone-active').forEach(el => {
				el.classList.remove('bases-kanban-drop-zone-active');
			});
		}

		this.hideDropIndicator();
		this.dragState = null;
	}
}

