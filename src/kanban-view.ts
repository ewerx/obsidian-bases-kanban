import {
	BasesView,
	BasesPropertyId,
	BasesEntry,
	BasesEntryGroup,
	QueryController,
	Value,
	NullValue,
	setIcon,
	Modal,
	App,
	Setting,
	Notice,
	StringValue,
	NumberValue,
	BooleanValue,
	DateValue,
	ListValue,
	LinkValue,
	TagValue,
	TFile,
	ViewOption,
	parsePropertyId,
} from 'obsidian';
import type BasesKanbanPlugin from './main';
import { DragDropManager } from './drag-drop';

// Constants
const NO_VALUE_COLUMN = '(No value)';

export const KanbanViewType = 'kanban';

export class KanbanView extends BasesView {
	type = KanbanViewType;
	scrollEl: HTMLElement;
	containerEl: HTMLElement;
	plugin: BasesKanbanPlugin;

	private groupByProperty: string | null = null;
	private dragDropManager: DragDropManager;
	private currentGroups: BasesEntryGroup[] = [];

	constructor(controller: QueryController, scrollEl: HTMLElement, plugin: BasesKanbanPlugin) {
		super(controller);
		this.scrollEl = scrollEl;
		this.plugin = plugin;
		this.containerEl = scrollEl.createDiv({ cls: 'bases-kanban-container' });

		// Initialize drag & drop manager with callbacks
		this.dragDropManager = new DragDropManager(this.app, {
			onColumnReorder: (newOrder) => this.handleColumnReorder(newOrder),
			onCardMoveToColumn: (file, newValue) => this.handleCardMoveToColumn(file, newValue),
			onCardReorder: (file, columnName, targetIndex) => this.handleCardReorder(file, columnName, targetIndex),
			getColumnNames: () => this.getCurrentColumnNames(),
			getGroupByProperty: () => this.getGroupByPropertyFromConfig(),
			getSortProperty: () => this.getSortPropertyFromConfig(),
		});
	}

	onload(): void {
		// Setup is done in constructor
	}

	onunload(): void {
		// Cleanup drag & drop
		this.dragDropManager.destroy();
	}

	public focus(): void {
		this.containerEl.focus({ preventScroll: true });
	}

	public onDataUpdated(): void {
		this.render();
	}

	private render(): void {
		this.containerEl.empty();

		// Get grouped data - this uses the Bases groupBy configuration
		const groupedData = this.data?.groupedData ?? [];
		
		// Check if we have groups (meaning groupBy is configured)
		const hasGroupBy = groupedData.length > 1 || 
			(groupedData.length === 1 && groupedData[0].key !== undefined && !(groupedData[0].key instanceof NullValue));

		if (!hasGroupBy && groupedData.length <= 1) {
			// No groupBy configured - show helpful message
			this.containerEl.createEl('p', {
				text: 'Set "Group by" in the sort menu to organize cards into columns.',
				cls: 'bases-kanban-placeholder'
			});
			return;
		}

		// Detect the groupBy property from the data (uses Bases groupBy configuration)
		this.groupByProperty = this.detectGroupByProperty(groupedData);

		// Sort groups by saved column order
		const sortedGroups = this.sortGroupsByColumnOrder(groupedData);
		this.currentGroups = sortedGroups;

		// Render the kanban board
		const boardEl = this.containerEl.createDiv({ cls: 'bases-kanban-board' });

		// Initialize drag & drop for this board
		this.dragDropManager.initBoard(boardEl);

		// Render columns with their index for drag & drop
		sortedGroups.forEach((group, columnIndex) => {
			this.renderColumn(boardEl, group, columnIndex);
		});

		// Add the "Add Column" button at the end
		this.renderAddColumnButton(boardEl);
	}

	private renderColumn(boardEl: HTMLElement, group: BasesEntryGroup, columnIndex: number): void {
			const columnEl = boardEl.createDiv({ cls: 'bases-kanban-column' });
		
		// Determine column name
		const columnName = this.getColumnName(group.key);
		const isNoValueColumn = group.key === undefined || group.key instanceof NullValue;

		// Store column name as data attribute for drag & drop
		columnEl.dataset.columnName = columnName;
		columnEl.dataset.columnIndex = String(columnIndex);
			
			// Column header
			const headerEl = columnEl.createDiv({ cls: 'bases-kanban-column-header' });

		// Add drag handle icon to header
		const dragHandleEl = headerEl.createDiv({ cls: 'bases-kanban-drag-handle' });
		setIcon(dragHandleEl, 'grip-vertical');
		
		// Left side: title and count
		const headerLeftEl = headerEl.createDiv({ cls: 'bases-kanban-header-left' });
		const titleEl = headerLeftEl.createEl('h3', { text: columnName });
		
		if (isNoValueColumn) {
			titleEl.addClass('bases-kanban-no-value-title');
		}
		
		headerLeftEl.createEl('span', { 
			text: `${group.entries.length}`,
				cls: 'bases-kanban-column-count'
			});

		// Right side: action buttons
		const headerRightEl = headerEl.createDiv({ cls: 'bases-kanban-header-actions' });
		
		// Add card button
		const addCardBtn = headerRightEl.createEl('button', {
			cls: 'bases-kanban-add-card-btn clickable-icon',
			attr: { 'aria-label': 'Add card' }
		});
		setIcon(addCardBtn, 'plus');
		addCardBtn.addEventListener('click', (evt) => {
			evt.stopPropagation();
			this.handleAddCard(isNoValueColumn ? null : columnName);
		});

		// For "No value" column, add button to set property on all files
		if (isNoValueColumn && group.entries.length > 0) {
			const setPropertyBtn = headerRightEl.createEl('button', {
				cls: 'bases-kanban-set-property-btn clickable-icon',
				attr: { 'aria-label': `Set property for ${group.entries.length} files` }
			});
			setIcon(setPropertyBtn, 'file-plus-2');
			setPropertyBtn.addEventListener('click', (evt) => {
				evt.stopPropagation();
				this.handleSetPropertyOnFiles(group.entries);
			});
		}

		// Make column draggable
		this.dragDropManager.makeColumnDraggable(columnEl, columnName, columnIndex);

			// Cards container
			const cardsEl = columnEl.createDiv({ cls: 'bases-kanban-cards' });

		// Set up cards container as drop zone
		this.dragDropManager.setupCardsDropZone(cardsEl, columnName);

		// Render cards with their index for drag & drop
		group.entries.forEach((entry, cardIndex) => {
			this.renderCard(cardsEl, entry, columnName, cardIndex);
		});
		}

	private renderAddColumnButton(boardEl: HTMLElement): void {
		const addColumnEl = boardEl.createDiv({ cls: 'bases-kanban-add-column' });
		
		const addBtn = addColumnEl.createEl('button', {
			cls: 'bases-kanban-add-column-btn',
		});
		setIcon(addBtn, 'plus');
		addBtn.createSpan({ text: 'Add column' });
		
		addBtn.addEventListener('click', () => {
			this.handleAddColumn();
		});
	}

	private getColumnName(key: Value | undefined): string {
		if (key === undefined || key instanceof NullValue) {
			return NO_VALUE_COLUMN;
		}
		return key.toString() || NO_VALUE_COLUMN;
	}

	private renderCard(container: HTMLElement, entry: BasesEntry, columnName: string, cardIndex: number): void {
		const cardEl = container.createDiv({ cls: 'bases-kanban-card' });

		// Store data attributes for drag & drop
		cardEl.dataset.filePath = entry.file.path;
		cardEl.dataset.columnName = columnName;
		cardEl.dataset.cardIndex = String(cardIndex);

		// Card title (always file name)
		const titleEl = cardEl.createDiv({ cls: 'bases-kanban-card-title' });
		const filePath = entry.file.path;
		
		const link = titleEl.createEl('a', { 
			text: entry.file.basename,
			cls: 'internal-link'
		});
		link.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.app.workspace.openLinkText(filePath, '', evt.ctrlKey || evt.metaKey);
		});

		// Render visible properties from the Properties panel
		const visibleProperties = this.data?.properties ?? [];
		
		// Filter out file.name since we already show the title
		const propertiesToShow = visibleProperties.filter(prop => prop !== 'file.name');
		
		if (propertiesToShow.length > 0) {
			const propsEl = cardEl.createDiv({ cls: 'bases-kanban-card-properties' });
			
			for (const propId of propertiesToShow) {
				const value = entry.getValue(propId);
				if (value === null || value instanceof NullValue) continue;
				
				this.renderPropertyRow(propsEl, propId, value);
			}
		}

		// Make card draggable
		this.dragDropManager.makeCardDraggable(cardEl, entry, columnName, cardIndex);
	}

	private renderPropertyRow(container: HTMLElement, propId: BasesPropertyId, value: Value): void {
		const rowEl = container.createDiv({ cls: 'bases-kanban-property-row' });
		
		// Icon based on value type
		const iconEl = rowEl.createSpan({ cls: 'bases-kanban-property-icon' });
		const iconName = this.getIconForValue(value, propId);
		setIcon(iconEl, iconName);
		
		// Value
		const valueEl = rowEl.createSpan({ cls: 'bases-kanban-property-value' });
		const { type } = parsePropertyId(propId);
		// use renderTo for formula values to get dynamic rendering
		if (type === "formula") {
			value.renderTo(valueEl, this.app.renderContext);
		} else {
			valueEl.setText(this.formatValue(value));
		}
	}

	private getIconForValue(value: Value, propId: BasesPropertyId): string {
		// Check property ID patterns first
		if (propId.startsWith('file.')) {
			const subProp = propId.substring(5);
			switch (subProp) {
				case 'name':
				case 'path':
				case 'folder':
					return 'file';
				case 'ext':
				case 'extension':
					return 'file-type';
				case 'size':
					return 'hard-drive';
				case 'ctime':
				case 'mtime':
				case 'created time':
				case 'modified time':
					return 'calendar';
				case 'tags':
					return 'tags';
				case 'links':
				case 'backlinks':
					return 'link';
				default:
					return 'file';
			}
		}

		if (propId.startsWith('formula.')) return 'square-function';

		// Check value type
		if (value instanceof DateValue) return 'calendar';
		if (value instanceof NumberValue) return 'hash';
		if (value instanceof BooleanValue) return 'check-square';
		if (value instanceof ListValue) return 'list';
		if (value instanceof LinkValue) return 'link';
		if (value instanceof TagValue) return 'tag';
		if (value instanceof StringValue) return 'type';
		
		// Default
		return 'text';
	}

	private formatValue(value: Value): string {
		if (value instanceof ListValue) {
			// For lists, show comma-separated values
			return value.toString();
		}
		if (value instanceof BooleanValue) {
			return value.isTruthy() ? 'Yes' : 'No';
		}
		return value.toString();
	}

	private handleAddCard(columnValue: string | null): void {
		const modal = new AddCardModal(this.app, (noteName) => {
			if (!noteName) return;
			void this.createCardNote(noteName, columnValue);
		});
		modal.open();
	}

	private async createCardNote(noteName: string, columnValue: string | null): Promise<void> {
		// Create the note
		const fileName = noteName.endsWith('.md') ? noteName : `${noteName}.md`;
		
		try {
			// Determine the folder - use current file's folder or root
			const activeFile = this.app.workspace.getActiveFile();
			const folder = activeFile?.parent?.path ?? '';
			const fullPath = folder ? `${folder}/${fileName}` : fileName;
			
			// Create file with frontmatter if we have a column value
			let content = '';
			if (columnValue !== null && this.groupByProperty) {
				content = `---\n${this.groupByProperty}: ${columnValue}\n---\n\n`;
			}
			
			const file = await this.app.vault.create(fullPath, content);
			
			// Open the new file
			const leaf = this.app.workspace.getLeaf();
			await leaf.openFile(file);
			
			new Notice(`Created "${noteName}"`);
		} catch (error) {
			new Notice(`Failed to create note: ${error}`);
		}
	}

	private handleAddColumn(): void {
		const groupByProperty = this.groupByProperty;
		
		// If we can't detect the groupBy property, prompt for it
		if (!groupByProperty) {
			new Notice('Could not detect the group by property. Configure "Group by" in the sort menu first.');
			return;
		}

		const modal = new AddColumnModal(this.app, this.data?.data ?? [], (columnValue, selectedFiles) => {
			if (!columnValue || selectedFiles.length === 0) return;
			void this.addColumnToFiles(groupByProperty, columnValue, selectedFiles);
		});
		modal.open();
	}

	private handleSetPropertyOnFiles(entries: BasesEntry[]): void {
		// Open modal to select which property to set and what value
		const modal = new SetPropertyModal(this.app, entries, (propertyName, propertyValue) => {
			if (!propertyName || !propertyValue) return;
			void this.setPropertyOnEntries(entries, propertyName, propertyValue);
		});
		modal.open();
	}

	private async addColumnToFiles(groupByProperty: string, columnValue: string, selectedFiles: BasesEntry[]): Promise<void> {
		// Update all selected files with the new property value using detected groupBy property
		for (const entry of selectedFiles) {
			await this.app.fileManager.processFrontMatter(entry.file, (fm) => {
				fm[groupByProperty] = columnValue;
			});
		}
		
		new Notice(`Added "${groupByProperty}: ${columnValue}" to ${selectedFiles.length} files`);
	}

	private async setPropertyOnEntries(entries: BasesEntry[], propertyName: string, propertyValue: string): Promise<void> {
		for (const entry of entries) {
			await this.app.fileManager.processFrontMatter(entry.file, (fm) => {
				fm[propertyName] = propertyValue;
			});
		}
		
		new Notice(`Set "${propertyName}: ${propertyValue}" on ${entries.length} files`);
	}

	// ==================== Drag & Drop Callbacks ====================

	/**
	 * Handle column reorder from drag & drop
	 */
	private handleColumnReorder(newOrder: string[]): void {
		this.updateColumnOrder(newOrder);
	}

	/**
	 * Handle card being moved to a different column
	 */
	private async handleCardMoveToColumn(file: TFile, newColumnValue: string): Promise<void> {
		const groupByProperty = this.getGroupByPropertyFromConfig();
		if (!groupByProperty) {
			new Notice('Could not detect the group by property. Ensure cards have frontmatter for the grouped property.');
			return;
		}

		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (newColumnValue === '') {
				// Moving to "(No value)" column - remove the property
				delete fm[groupByProperty];
			} else {
				fm[groupByProperty] = newColumnValue;
			}
		});
	}

	/**
	 * Handle card being reordered within a column.
	 * Renumbers all cards in the column with clean integers.
	 * Respects ascending/descending sort direction.
	 */
	private async handleCardReorder(file: TFile, columnName: string, targetIndex: number): Promise<void> {
		const sortProperty = this.getSortPropertyFromConfig();
		if (!sortProperty) {
			return; // No sort property configured, nothing to do
		}

		// Find the column's entries
		const group = this.currentGroups.find(g => this.getColumnName(g.key) === columnName);
		if (!group) {
			return;
		}

		// Build new order: remove the moved card, insert at target position
		const movedEntry = group.entries.find(e => e.file.path === file.path);
		if (!movedEntry) {
			return;
		}

		const otherEntries = group.entries.filter(e => e.file.path !== file.path);
		const newOrder: BasesEntry[] = [
			...otherEntries.slice(0, targetIndex),
			movedEntry,
			...otherEntries.slice(targetIndex)
		];

		// Get sort direction from Bases config
		const isDescending = this.getSortDirection() === 'DESC';

		// Renumber all cards with clean integers
		await this.renumberCardsInOrder(newOrder, sortProperty, isDescending);
	}

	/**
	 * Get the sort direction for the sort property (ASC or DESC)
	 */
	private getSortDirection(): 'ASC' | 'DESC' {
		const sortConfigs = this.config?.getSort() ?? [];
		if (sortConfigs.length === 1) {
			return sortConfigs[0].direction;
		}
		return 'ASC'; // Default to ascending
	}

	/**
	 * Assign clean integer values to all cards in the given order.
	 * For ascending: 1, 2, 3, ... (first card gets lowest value)
	 * For descending: n, n-1, n-2, ... (first card gets highest value)
	 */
	private async renumberCardsInOrder(
		entries: BasesEntry[], 
		sortProperty: string,
		isDescending: boolean
	): Promise<void> {
		const count = entries.length;
		
		// Update all files with their new sort values
		const updates = entries.map((entry, index) => {
			// For ascending: 1, 2, 3, ...
			// For descending: n, n-1, n-2, ... (so highest values sort first)
			const newValue = isDescending ? (count - index) : (index + 1);
			
			return this.app.fileManager.processFrontMatter(entry.file, (fm) => {
				fm[sortProperty] = newValue;
			});
		});

		// Run all updates in parallel for speed
		await Promise.all(updates);
	}

	/**
	 * Get current column names in display order
	 */
	private getCurrentColumnNames(): string[] {
		return this.currentGroups.map(group => this.getColumnName(group.key));
	}

	/**
	 * Detect the groupBy property by finding which frontmatter property matches the group key values.
	 * This infers the groupBy from the Bases configuration without requiring separate setup.
	 */
	private detectGroupByProperty(groups: BasesEntryGroup[]): string | null {
		// Find a group with a non-null key and at least one entry
		const groupWithKey = groups.find(g => g.hasKey() && g.entries.length > 0);
		if (!groupWithKey || !groupWithKey.key) {
			return null;
		}

		const keyString = groupWithKey.key.toString();
		const entry = groupWithKey.entries[0];
		
		// Access the file's frontmatter directly from the metadata cache
		const fileCache = this.app.metadataCache.getFileCache(entry.file);
		const frontmatter = fileCache?.frontmatter;
		
		if (frontmatter) {
			// Check each frontmatter property to find one that matches the group key
			for (const [propName, propValue] of Object.entries(frontmatter)) {
				// Skip internal properties
				if (propName === 'position') continue;
				
				// Convert value to string for comparison
				const valueStr = String(propValue);
				if (valueStr === keyString) {
					return propName;
				}
			}
		}
		
		// Fallback: check visible properties via the Bases API
		const properties = this.data?.properties ?? [];
		for (const propId of properties) {
			const value = entry.getValue(propId);
			if (value && value.toString() === keyString) {
				// Extract the property name from the BasesPropertyId
				// Format: "note.propertyName" for frontmatter properties
				if (propId.startsWith('note.')) {
					return propId.substring(5);
				}
			}
		}

		return null;
	}

	/**
	 * Get the groupBy property name (detected from data)
	 */
	private getGroupByPropertyFromConfig(): string | null {
		return this.groupByProperty;
	}

	/**
	 * Get the sort property from Bases config.
	 * Only returns a property if sorting by a single numeric property.
	 */
	private getSortPropertyFromConfig(): string | null {
		const sortConfigs = this.config?.getSort() ?? [];
		
		// Only support reordering if there's exactly one sort property
		if (sortConfigs.length !== 1) {
			return null;
		}
		
		const sortConfig = sortConfigs[0];
		const propId = sortConfig.property;
		
		// Extract the property name from the BasesPropertyId
		// Format: "note.propertyName" for frontmatter properties
		if (propId.startsWith('note.')) {
			return propId.substring(5);
		}
		
		// For other property types, we can't reorder via frontmatter
		return null;
	}

	/**
	 * Get the column order from config
	 */
	private getColumnOrderFromConfig(): string[] {
		const configValue = this.config?.get('columnOrder');
		if (typeof configValue === 'string' && configValue.length > 0) {
			// Parse comma-separated string
			return configValue.split(',').map(s => s.trim()).filter(s => s.length > 0);
		}
		if (Array.isArray(configValue)) {
			return configValue.filter((v): v is string => typeof v === 'string');
		}
		return [];
	}

	/**
	 * Sort groups based on saved column order
	 */
	private sortGroupsByColumnOrder(groups: BasesEntryGroup[]): BasesEntryGroup[] {
		const columnOrder = this.getColumnOrderFromConfig();
		if (columnOrder.length === 0) {
			return groups;
		}

		const orderMap = new Map(columnOrder.map((name, index) => [name, index]));
		
		return [...groups].sort((a, b) => {
			const nameA = this.getColumnName(a.key);
			const nameB = this.getColumnName(b.key);
			
			const indexA = orderMap.get(nameA) ?? Infinity;
			const indexB = orderMap.get(nameB) ?? Infinity;
			
			// If both have no order, keep original order
			if (indexA === Infinity && indexB === Infinity) {
				return 0;
			}
			
			return indexA - indexB;
		});
	}

	/**
	 * Update column order in config
	 */
	public updateColumnOrder(newOrder: string[]): void {
		// Store as comma-separated string for TextOption compatibility
		const orderString = newOrder.join(',');
		this.config?.set('columnOrder', orderString);
	}

	/**
	 * View options exposed to Bases for configuration persistence.
	 * 
	 * Note: groupBy and sort properties are automatically detected from Bases config.
	 * - groupBy: Uses the "Group by" setting from the Sort menu
	 * - sort: Uses the sort property from the Sort menu (for in-column reordering)
	 * - columnOrder: Persisted automatically when columns are reordered via drag & drop
	 */
	static getViewOptions(): ViewOption[] {
		return [
			{
				key: 'columnOrder',
				displayName: 'Column order',
				type: 'text' as const,
				default: '',
				placeholder: 'Managed by drag & drop',
				// Hide this option as it's managed automatically
				shouldHide: () => true,
			},
		];
	}
}

// Modal for adding a new card
class AddCardModal extends Modal {
	private onSubmit: (noteName: string) => void;
	private inputEl: HTMLInputElement;

	constructor(app: App, onSubmit: (noteName: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bases-kanban-modal');
		
		contentEl.createEl('h3', { text: 'Create new card' });
		
		new Setting(contentEl)
			.setName('Note name')
			.addText(text => {
				this.inputEl = text.inputEl;
				text.setPlaceholder('Enter note name')
					.onChange(() => {});
			});
		
		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Create')
				.setCta()
				.onClick(() => {
					const value = this.inputEl.value.trim();
					if (value) {
						this.onSubmit(value);
						this.close();
					}
				}))
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()));
		
		// Focus input
		this.inputEl.focus();
		
		// Handle Enter key
		this.inputEl.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter') {
				evt.preventDefault();
				const value = this.inputEl.value.trim();
				if (value) {
					this.onSubmit(value);
					this.close();
				}
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Modal for adding a new column
class AddColumnModal extends Modal {
	private onSubmit: (columnValue: string, selectedFiles: BasesEntry[]) => void;
	private entries: BasesEntry[];
	private columnValueInput: HTMLInputElement;
	private selectedFiles: Set<BasesEntry> = new Set();

	constructor(app: App, entries: BasesEntry[], onSubmit: (columnValue: string, selectedFiles: BasesEntry[]) => void) {
		super(app);
		this.entries = entries;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bases-kanban-modal');
		contentEl.addClass('bases-kanban-add-column-modal');
		
		contentEl.createEl('h3', { text: 'Add new column' });
		
		new Setting(contentEl)
			.setName('Column value')
			.setDesc('The value to assign to selected files')
			.addText(text => {
				this.columnValueInput = text.inputEl;
				text.setPlaceholder('Enter column name');
			});
		
		// File selection
		contentEl.createEl('h4', { text: 'Select files to add to this column' });
		
		const fileListEl = contentEl.createDiv({ cls: 'bases-kanban-file-list' });
		
		for (const entry of this.entries) {
			const fileEl = fileListEl.createDiv({ cls: 'bases-kanban-file-item' });
			
			const checkbox = fileEl.createEl('input', {
				type: 'checkbox',
				attr: { id: `file-${entry.file.path}` }
			});
			
			fileEl.createEl('label', {
				text: entry.file.basename,
				attr: { for: `file-${entry.file.path}` }
			});
			
			checkbox.addEventListener('change', () => {
				if (checkbox.checked) {
					this.selectedFiles.add(entry);
				} else {
					this.selectedFiles.delete(entry);
				}
			});
		}
		
		// Buttons
		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Create column')
				.setCta()
				.onClick(() => {
					const value = this.columnValueInput.value.trim();
					if (value && this.selectedFiles.size > 0) {
						this.onSubmit(value, Array.from(this.selectedFiles));
						this.close();
					} else if (!value) {
						new Notice('Please enter a column name');
					} else {
						new Notice('Please select at least one file');
					}
				}))
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()));
		
		this.columnValueInput.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Modal for setting a property on multiple files
class SetPropertyModal extends Modal {
	private onSubmit: (propertyName: string, propertyValue: string) => void;
	private entries: BasesEntry[];
	private propertyInput: HTMLInputElement;
	private valueInput: HTMLInputElement;

	constructor(app: App, entries: BasesEntry[], onSubmit: (propertyName: string, propertyValue: string) => void) {
		super(app);
		this.entries = entries;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('bases-kanban-modal');
		
		contentEl.createEl('h3', { text: `Set property on ${this.entries.length} files` });
		contentEl.createEl('p', { 
			text: 'These files are missing the column property. Set a value to move them to a column.',
			cls: 'setting-item-description'
		});
		
		new Setting(contentEl)
			.setName('Property name')
			.addText(text => {
				this.propertyInput = text.inputEl;
				text.setPlaceholder('e.g. Status');
			});
		
		new Setting(contentEl)
			.setName('Value')
			.addText(text => {
				this.valueInput = text.inputEl;
				text.setPlaceholder('e.g. Todo');
			});
		
		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText('Apply to all')
				.setCta()
				.onClick(() => {
					const prop = this.propertyInput.value.trim();
					const val = this.valueInput.value.trim();
					if (prop && val) {
						this.onSubmit(prop, val);
						this.close();
					} else {
						new Notice('Please enter both property name and value');
					}
				}))
			.addButton(btn => btn
				.setButtonText('Cancel')
				.onClick(() => this.close()));
		
		this.propertyInput.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
