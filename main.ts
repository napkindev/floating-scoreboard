import { App, Plugin, PluginSettingTab, Setting, TFile, moment, Notice, TextAreaComponent } from "obsidian";

interface FloatingBoxSettings {
    // Color settings
    backgroundColor: string;
    customBackgroundColor: string;
    headerColor: string;
    customHeaderColor: string;
    textColor: string;
    customTextColor: string;
    todayTextColor: string;
    customTodayTextColor: string;

    // Text modification settings
    headerFontSize: number;
    paragraphFontSize: number;
    todayTextBold: boolean;

    // Other settings
    position: { x: number; y: number };
    size: { width: number; height: number };
    daysToShow: number;
    noDataMessage: string;

    // Data fields
    dataFields: Array<{ 
        type: 'dataview' | 'completedTasks' | 'uncompletedTasks' | 'wordCount' | 'lineBreak' | 'dataviewjs',
        displayName: string,
        dataviewField?: string,
        customOverride?: string,
        showInHighScores: boolean,
        dataviewjsScript?: string  // New property for DataviewJS script
    }>;

    // Custom time periods
    customTimePeriods: Array<{
        value: number;
        unit: 'days' | 'weeks' | 'months' | 'years';
        label: string;
        showDate: boolean;
    }>;

    // New settings for padding
    padding: number;

    // New setting for displaying "Display As" text
    showDisplayAsText: boolean;

    // New setting for daily note end time
    dailyNoteEndTime: string;
}

const DEFAULT_SETTINGS: FloatingBoxSettings = {
    backgroundColor: 'default',
    customBackgroundColor: '',
    headerColor: 'default',
    customHeaderColor: '',
    textColor: 'default',
    customTextColor: '',
    todayTextColor: 'default',
    customTodayTextColor: '',
    position: { x: 20, y: 50 },
    size: { width: 600, height: 300 },
    daysToShow: 3,
    headerFontSize: 16,
    paragraphFontSize: 14,
    todayTextBold: false,
    noDataMessage: 'N/A',
    dataFields: [
        { type: 'completedTasks', displayName: '✅ Completed', showInHighScores: true }
    ],
    customTimePeriods: [
        { value: 30, unit: 'days', label: '30D', showDate: true }
    ],
    padding: 20,
    showDisplayAsText: true,
    dailyNoteEndTime: '04:00', // Default to 4:00 AM
}

export default class FloatingBoxPlugin extends Plugin {
    floatingBox: HTMLElement;
    settings: FloatingBoxSettings;
    isDragging: boolean = false;
    isAutoResizing: boolean = false;
    dragOffset: { x: number; y: number } = { x: 0, y: 0 };
    private cachedContent: string = '';
    private minWidth: number = 200;  // Set a default minimum width
    private minHeight: number = 100; // Set a default minimum height
    private isVisible: boolean = true;

    async onload() {
        await this.loadSettings();
        this.createFloatingBox();
        this.addSettingTab(new FloatingBoxSettingTab(this.app, this));
        this.updateFloatingBoxContent();

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => this.updateFloatingBoxContent())
        );

        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.updateFloatingBoxContent();
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on('layout-change', () => this.updateFloatingBoxContent())
        );

        this.registerDomEvent(document, 'click', () => this.updateFloatingBoxContent());

        this.addCommand({
            id: 'toggle-floating-box-resize',
            name: 'Toggle Floating Box Resize Mode',
            hotkeys: [{ modifiers: ["Meta"], key: "r" }],
            callback: () => {
                this.isAutoResizing = !this.isAutoResizing;
                if (!this.isAutoResizing) {
                    this.saveSettings();
                }
            }
        });

        this.addCommand({
            id: 'toggle-floating-box-visibility',
            name: 'Toggle Floating Box Visibility',
            hotkeys: [{ modifiers: ["Mod"], key: "h" }],
            callback: () => this.toggleVisibility()
        });

        this.addCommand({
            id: 'center-floating-box',
            name: 'Center Floating Box',
            hotkeys: [{ modifiers: ["Mod"], key: "j" }],
            callback: () => this.centerFloatingBox()
        });
    }

    onunload() {
        if (this.floatingBox && this.floatingBox.parentNode) {
            this.floatingBox.parentNode.removeChild(this.floatingBox);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        if (!this.settings.dailyNoteEndTime) {
            this.settings.dailyNoteEndTime = DEFAULT_SETTINGS.dailyNoteEndTime;
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.updateFloatingBoxContent();
    }

    private createFloatingBox() {
        this.floatingBox = document.createElement('div');
        this.floatingBox.addClass('floating-box');
        this.floatingBox.style.position = 'fixed';
        this.floatingBox.style.border = '2px solid var(--background-modifier-border)';
        this.floatingBox.style.borderRadius = '10px';
        this.floatingBox.style.zIndex = '1000';
        this.floatingBox.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        this.floatingBox.style.cursor = 'move';
        this.floatingBox.style.display = 'flex';
        this.floatingBox.style.flexDirection = 'column';
        this.floatingBox.style.justifyContent = 'flex-start';
        this.floatingBox.style.userSelect = 'none';
        this.floatingBox.style.webkitUserSelect = 'none';
        this.floatingBox.style.overflow = 'auto';

        const style = document.createElement('style');
        style.textContent = `
            .floating-box * {
                margin: 0;
                padding: 0;
            }
            .floating-box h3 {
                margin-bottom: 10px;
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(this.floatingBox);

        this.updateFloatingBoxPosition();
        this.updateFloatingBoxSize();
        this.updateFloatingBoxStyle();

        this.floatingBox.addEventListener('mousedown', this.onMouseDown.bind(this));
        document.addEventListener('mousemove', this.onMouseMove.bind(this));
        document.addEventListener('mouseup', this.onMouseUp.bind(this));
    }

    private async updateFloatingBoxContent() {
        try {
            if (this.floatingBox) {
                const newContent = await this.generateContent();
                if (newContent !== this.cachedContent) {
                    this.cachedContent = newContent;
                    this.floatingBox.innerHTML = this.cachedContent;
                    this.updateFloatingBoxStyle();
                    this.updateMinimumSize();
                }
            }
        } catch (error) {
            console.error('Error updating floating box content:', error);
            // Optionally, show a notice to the user
            new Notice('Error updating floating box. Check console for details.');
        }
    }

    private async generateContent(): Promise<string> {
        try {
            let content = '';
            const dailyNotePlugin = (this.app as any).internalPlugins.plugins['daily-notes'];
            if (dailyNotePlugin && dailyNotePlugin.enabled) {
                const currentMoment = moment();
                const endTimeMoment = moment(this.settings.dailyNoteEndTime, 'HH:mm');
                
                // Adjust the current date if it's before the end time
                if (currentMoment.isBefore(endTimeMoment)) {
                    currentMoment.subtract(1, 'day');
                }

                const today = currentMoment.startOf('day');
                const dates = Array.from({length: this.settings.daysToShow}, (_, i) => moment(today).subtract(i, 'days'));

                const headerColorMap = {
                    'default': 'var(--text-normal)',
                    'accent': 'var(--text-accent)',
                    'muted': 'var(--text-muted)'
                };

                const headerColor = this.settings.headerColor === 'custom'
                    ? this.settings.customHeaderColor
                    : headerColorMap[this.settings.headerColor as keyof typeof headerColorMap];

                // Create a container for all columns
                content += '<div style="display: flex; justify-content: space-between; width: 100%;">';

                // Create columns for each date
                for (const [dateIndex, currentDate] of dates.entries()) {
                    const filePath = this.getDailyNotePath(currentDate);
                    if (filePath) {
                        const fileContent = await this.getFileContent(filePath);
                        
                        content += '<div style="flex: 1; margin-right: 10px;">';
                        
                        const isToday = currentDate.isSame(today, 'day');
                        const todayTextColor = this.getTodayTextColor();
                        const todayTextStyle = isToday ? `color: ${todayTextColor}; ${this.settings.todayTextBold ? 'font-weight: bold;' : ''}` : '';

                        content += `<h3 style="font-size: ${this.settings.headerFontSize}px; color: ${headerColor}; white-space: nowrap;">${this.formatDate(currentDate, today)}</h3>`;
                        
                        for (const field of this.settings.dataFields) {
                            if (field.type === 'lineBreak') {
                                content += '<div style="height: 10px;"></div>'; // Adjust height as needed
                                continue;
                            }

                            let fieldData: string;
                            switch (field.type) {
                                case 'dataview':
                                    fieldData = this.getDataViewField(fileContent, field.dataviewField || '');
                                    break;
                                case 'dataviewjs':
                                    fieldData = await this.executeDataviewJSScript(field.dataviewjsScript || '', filePath);
                                    break;
                                case 'completedTasks':
                                    fieldData = this.countCompletedTasks(fileContent).toString() || this.settings.noDataMessage;
                                    break;
                                case 'uncompletedTasks':
                                    fieldData = this.countUncompletedTasks(fileContent).toString() || this.settings.noDataMessage;
                                    break;
                                case 'wordCount':
                                    fieldData = this.countWords(fileContent).toString() || this.settings.noDataMessage;
                                    break;
                            }
                            const displayText = (this.settings.showDisplayAsText || dateIndex === 0) ? `${field.displayName} ` : '';
                            content += `
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                    <span style="font-size: ${this.settings.paragraphFontSize}px; white-space: nowrap; ${todayTextStyle}">${displayText}${fieldData}</span>
                                </div>`;
                        }
                        
                        content += '</div>';
                    }
                }

                // Add custom time period columns
                for (const [periodIndex, period] of this.settings.customTimePeriods.entries()) {
                    content += '<div style="flex: 1.5; margin-left: 10px; min-width: 150px;">';
                    
                    // Change this line to use the label directly without adding "Best"
                    content += `<h3 style="font-size: ${this.settings.headerFontSize}px; color: ${headerColor}; white-space: nowrap;">${period.label}</h3>`;
                    
                    for (const field of this.settings.dataFields) {
                        if (field.type === 'lineBreak') {
                            content += '<div style="height: 10px;"></div>'; // Adjust height as needed
                            continue;
                        }

                        if (field.showInHighScores === false) {
                            continue;
                        }

                        if (field.customOverride) {
                            // Use the custom override if it exists
                            const displayText = (this.settings.showDisplayAsText || periodIndex + dates.length === 0) ? `${field.displayName} ` : '';
                            content += `
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                    <span style="font-size: ${this.settings.paragraphFontSize}px; white-space: nowrap;">${displayText}${field.customOverride}</span>
                                </div>`;
                        } else {
                            const best = await this.getBestForPeriod(field, period);
                            if (best.value !== '') {  // Only add content if it's not an empty string
                                const displayText = (this.settings.showDisplayAsText || periodIndex + dates.length === 0) ? `${field.displayName} ` : '';
                                content += `
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                                        <span style="font-size: ${this.settings.paragraphFontSize}px; white-space: nowrap;">${displayText}${best.value}</span>
                                        ${period.showDate ? `<span style="font-size: calc(${this.settings.paragraphFontSize}px * 0.8); color: var(--text-muted); white-space: nowrap; margin-left: 5px;">(${best.date})</span>` : ''}
                                    </div>`;
                            }
                        }
                    }
                    
                    content += '</div>';
                }

                // Close the container
                content += '</div>';
            } else {
                content = '<p>Daily notes plugin is not enabled.</p>';
            }
            return content;
        } catch (error) {
            console.error('Error generating content:', error);
            return '<p>Error generating content. Please check the console.</p>';
        }
    }

    public updateFloatingBoxStyle() {
        if (this.floatingBox) {
            const bgColorMap = {
                'default': 'var(--background-primary)',
                'secondary': 'var(--background-secondary)',
                'tertiary': 'var(--background-tertiary)'
            };
            const textColorMap = {
                'default': 'var(--text-normal)',
                'muted': 'var(--text-muted)',
                'faint': 'var(--text-faint)'
            };
            const headerColorMap = {
                'default': 'var(--text-normal)',
                'accent': 'var(--text-accent)',
                'muted': 'var(--text-muted)'
            };

            this.floatingBox.style.backgroundColor = this.settings.backgroundColor === 'custom' 
                ? this.settings.customBackgroundColor 
                : bgColorMap[this.settings.backgroundColor as keyof typeof bgColorMap];

            this.floatingBox.style.color = this.settings.textColor === 'custom'
                ? this.settings.customTextColor
                : textColorMap[this.settings.textColor as keyof typeof textColorMap];

            const headerColor = this.settings.headerColor === 'custom'
                ? this.settings.customHeaderColor
                : headerColorMap[this.settings.headerColor as keyof typeof headerColorMap];
            
            // Apply header color to all h3 elements
            this.floatingBox.querySelectorAll('h3').forEach(header => {
                header.style.color = headerColor;
            });

            // Apply padding
            this.floatingBox.style.padding = `${this.settings.padding}px`;
            this.floatingBox.style.fontSize = `${this.settings.paragraphFontSize}px`;
            this.floatingBox.querySelectorAll('h3').forEach(header => {
                header.style.fontSize = `${this.settings.headerFontSize}px`;
                header.style.marginBottom = '10px';
            });
            this.updateMinimumSize();
        }
    }

    private formatDate(inputDate: moment.Moment, today: moment.Moment): string {
        if (inputDate.isSame(today, 'day')) {
            return "Today";
        } else if (inputDate.isSame(today.clone().subtract(1, 'day'), 'day')) {
            return "Yest";
        } else {
            return inputDate.format("MMM D");
        }
    }

    private getDataViewField(content: string, fieldName: string): string {
        const match = content.match(new RegExp(`${fieldName}:: (.+)`));
        if (match) {
            // Process the matched value for Markdown-style formatting
            return this.processMarkdownFormatting(match[1].trim());
        }
        return this.settings.noDataMessage;
    }

    private processMarkdownFormatting(text: string): string {
        // Replace ***text*** with <span class="ob-bold-italic">text</span> for bold and italic
        text = text.replace(/\*\*\*(.*?)\*\*\*/g, '<span class="cm-strong cm-em">$1</span>');
        // Replace **text** with <span class="ob-bold">text</span> for bold
        text = text.replace(/\*\*(.*?)\*\*/g, '<span class="cm-strong">$1</span>');
        // Replace *text* with <span class="ob-italic">text</span> for italics
        text = text.replace(/\*(.*?)\*/g, '<span class="cm-em">$1</span>');
        return text;
    }

    private getDailyNotePath(date: moment.Moment): string | null {
        const dailyNotePlugin = (this.app as any).internalPlugins.plugins['daily-notes'];
        if (dailyNotePlugin && dailyNotePlugin.enabled) {
            let format = 'YYYY-MM-DD';
            let folder = '';

            if (dailyNotePlugin.instance && dailyNotePlugin.instance.options) {
                format = dailyNotePlugin.instance.options.format || format;
                folder = dailyNotePlugin.instance.options.folder || folder;
            }

            const fileName = date.format(format);
            return `${folder ? folder + '/' : ''}${fileName}.md`;
        }
        return null;
    }

    private async getFileContent(filePath: string): Promise<string> {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            return await this.app.vault.read(file);
        }
        return '';
    }

    private countCompletedTasks(content: string): number {
        const completedTasks = content.match(/- \[x\] .+/g) || [];
        return completedTasks.length;
    }

    private countUncompletedTasks(content: string): number {
        const uncompletedTasks = content.match(/- \[ \] .+/g) || [];
        return uncompletedTasks.length;
    }

    private countWords(content: string): number {
        return content.split(/\s+/).filter(word => word.length > 0).length;
    }

    private updateFloatingBoxPosition() {
        this.floatingBox.style.left = `${this.settings.position.x}px`;
        this.floatingBox.style.top = `${this.settings.position.y}px`;
    }

    private updateFloatingBoxSize() {
        this.floatingBox.style.width = `${this.settings.size.width}px`;
        this.floatingBox.style.height = `${this.settings.size.height}px`;
        this.updateMinimumSize();
    }

    public updateMinimumSize() {
        // Temporarily remove any size constraints
        this.floatingBox.style.width = 'auto';
        this.floatingBox.style.height = 'auto';

        // Get the actual content size
        const contentWidth = this.floatingBox.scrollWidth;
        const contentHeight = this.floatingBox.scrollHeight;

        // Update minimum size based on content
        this.minWidth = Math.max(200, contentWidth);
        this.minHeight = Math.max(100, contentHeight);

        // Reapply the current size, but not smaller than the minimum
        this.settings.size.width = Math.max(this.minWidth, this.settings.size.width);
        this.settings.size.height = Math.max(this.minHeight, this.settings.size.height);
        this.floatingBox.style.width = `${this.settings.size.width}px`;
        this.floatingBox.style.height = `${this.settings.size.height}px`;
    }

    private onMouseDown(e: MouseEvent) {
        this.isDragging = true;
        this.dragOffset.x = e.clientX - this.settings.position.x;
        this.dragOffset.y = e.clientY - this.settings.position.y;
    }

    private onMouseMove(e: MouseEvent) {
        if (this.isDragging) {
            this.settings.position.x = e.clientX - this.dragOffset.x;
            this.settings.position.y = e.clientY - this.dragOffset.y;
            this.updateFloatingBoxPosition();
        } else if (this.isAutoResizing) {
            const newWidth = e.clientX - this.settings.position.x;
            const newHeight = e.clientY - this.settings.position.y;
            
            this.settings.size.width = Math.max(this.minWidth, newWidth);
            this.settings.size.height = Math.max(this.minHeight, newHeight);
            this.updateFloatingBoxSize();
        }
    }

    private onMouseUp() {
        this.isDragging = false;
        this.saveSettings();
    }

    private async getBestForPeriod(field: { type: string, displayName: string, dataviewField?: string, showInHighScores?: boolean }, period: { value: number, unit: string }): Promise<{ value: string, date: string }> {
        try {
            if (field.type === 'lineBreak') {
                return { value: '', date: '' };
            }

            if (field.showInHighScores === false) {
                return { value: '', date: '' };
            }

            const currentMoment = moment();
            const endTimeMoment = moment(this.settings.dailyNoteEndTime, 'HH:mm');
            
            // Adjust the current date if it's before the end time
            if (currentMoment.isBefore(endTimeMoment)) {
                currentMoment.subtract(1, 'day');
            }

            const today = currentMoment.startOf('day');
            const startDate = moment(today).subtract(period.value, period.unit as moment.unitOfTime.DurationConstructor);
            const daysInPeriod = today.diff(startDate, 'days');
            // Change this line to exclude today
            const daysToCheck = Array.from({length: daysInPeriod}, (_, i) => moment(today).subtract(i + 1, 'days'));
            
            let bestValue: number | null = null;
            let bestDate: string | null = null;

            for (const date of daysToCheck) {
                const filePath = this.getDailyNotePath(date);
                if (filePath) {
                    const fileContent = await this.getFileContent(filePath);
                    let value: string | number;

                    switch (field.type) {
                        case 'dataview':
                            value = this.getDataViewField(fileContent, field.dataviewField || '');
                            break;
                        case 'completedTasks':
                            value = this.countCompletedTasks(fileContent);
                            break;
                        case 'uncompletedTasks':
                            value = this.countUncompletedTasks(fileContent);
                            break;
                        case 'wordCount':
                            value = this.countWords(fileContent);
                            break;
                        default:
                            value = this.settings.noDataMessage;
                    }

                    if (typeof value === 'number') {
                        if (bestValue === null || value > bestValue) {
                            bestValue = value;
                            bestDate = date.format('MMM D');
                        }
                    } else if (typeof value === 'string' && !isNaN(Number(value))) {
                        const numValue = Number(value);
                        if (bestValue === null || numValue > bestValue) {
                            bestValue = numValue;
                            bestDate = date.format('MMM D');
                        }
                    }
                }
            }

            return {
                value: bestValue !== null ? bestValue.toString() : this.settings.noDataMessage,
                date: bestDate || 'N/A'
            };
        } catch (error) {
            console.error('Error getting best for period:', error);
            new Notice('Error calculating best value. Check console for details.');
            return { value: 'Error', date: 'N/A' };
        }
    }

    private getTodayTextColor(): string {
        const textColorMap = {
            'default': 'var(--text-normal)',
            'muted': 'var(--text-muted)',
            'faint': 'var(--text-faint)',
            'accent': 'var(--text-accent)'
        };

        return this.settings.todayTextColor === 'custom'
            ? this.settings.customTodayTextColor
            : textColorMap[this.settings.todayTextColor as keyof typeof textColorMap];
    }

    private toggleVisibility() {
        this.isVisible = !this.isVisible;
        this.floatingBox.style.display = this.isVisible ? 'flex' : 'none';
    }

    private centerFloatingBox() {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        
        this.settings.position.x = (windowWidth - this.settings.size.width) / 2;
        this.settings.position.y = (windowHeight - this.settings.size.height) / 2;
        
        this.updateFloatingBoxPosition();
        this.saveSettings();
    }

    private async executeDataviewJSScript(script: string, filePath: string): Promise<string> {
        // Wait for Dataview to be ready
        while (!this.isDataviewReady()) {
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms before checking again
        }

        try {
            // Check if the Dataview plugin is available
            const dataviewApi = (this.app as any).plugins.plugins['dataview']?.api;
            if (!dataviewApi) {
                return 'Dataview plugin not available';
            }

            // Get the current page
            const page = await dataviewApi.page(filePath);

            // Create a context for the script
            const context = {
                dv: dataviewApi,
                current: page,
                // Add any other context variables you want to make available to the script
            };

            // Create a new function from the script
            const scriptFunction = new Function('dv', 'current', `
                ${script}
            `);

            // Execute the function
            const result = await scriptFunction(context.dv, context.current);
            return result?.toString() || this.settings.noDataMessage;
        } catch (error) {
            console.error("Error executing DataviewJS script:", error);
            return `Error: ${error.message}`;
        }
    }

    private isDataviewReady(): boolean {
        const dataviewApi = (this.app as any).plugins.plugins['dataview']?.api;
        return dataviewApi && dataviewApi.index && dataviewApi.index.initialized;
    }
}

class FloatingBoxSettingTab extends PluginSettingTab {
    plugin: FloatingBoxPlugin;
    containerEl: HTMLElement;

    constructor(app: App, plugin: FloatingBoxPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        // Data Fields
        containerEl.createEl('h3', {text: 'Data Fields'});
        const dataFieldsContainer = containerEl.createEl('div');
        this.plugin.settings.dataFields.forEach((field, index) => {
            this.createDataFieldSetting(dataFieldsContainer, field, index);
        });

        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('+')
                .onClick(() => {
                    this.plugin.settings.dataFields.push({ 
                        type: 'dataview', 
                        displayName: '', 
                        dataviewField: '',
                        customOverride: '',
                        showInHighScores: true
                    });
                    this.createDataFieldSetting(dataFieldsContainer, this.plugin.settings.dataFields[this.plugin.settings.dataFields.length - 1], this.plugin.settings.dataFields.length - 1);
                    this.plugin.saveSettings();
                }));

        // High Score Time Periods
        containerEl.createEl('h3', {text: 'High Score Time Periods'});
        const timePeriodContainer = containerEl.createEl('div');
        this.plugin.settings.customTimePeriods.forEach((period, index) => {
            this.createTimePeriodSetting(timePeriodContainer, period, index);
        });

        new Setting(containerEl)
            .addButton(button => button
                .setButtonText('+')
                .onClick(() => {
                    this.plugin.settings.customTimePeriods.push({ 
                        value: 30, 
                        unit: 'days',
                        label: '30D',
                        showDate: true
                    });
                    this.createTimePeriodSetting(timePeriodContainer, this.plugin.settings.customTimePeriods[this.plugin.settings.customTimePeriods.length - 1], this.plugin.settings.customTimePeriods.length - 1);
                    this.plugin.saveSettings();
                }));

        // Other Settings
        containerEl.createEl('h3', {text: 'Other Settings'});

        new Setting(containerEl)
            .setName('Days to Show')
            .setDesc('Set the number of days to display in the floating box')
            .addSlider(slider => slider
                .setLimits(1, 14, 1)
                .setValue(this.plugin.settings.daysToShow)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.daysToShow = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('No Data Message')
            .setDesc('Set the message to display when no data is found')
            .addText(text => text
                .setPlaceholder('e.g., N/A')
                .setValue(this.plugin.settings.noDataMessage)
                .onChange(async (value) => {
                    this.plugin.settings.noDataMessage = value;
                    await this.plugin.saveSettings();
                }));

        // Color Settings
        containerEl.createEl('h3', {text: 'Color Settings'});
        this.addColorSetting(containerEl, 'Box Color', 'backgroundColor', 'customBackgroundColor');
        this.addColorSetting(containerEl, 'Header Color', 'headerColor', 'customHeaderColor');
        this.addColorSetting(containerEl, 'Text Color', 'textColor', 'customTextColor');
        this.addColorSetting(containerEl, 'Today\'s Text Color', 'todayTextColor', 'customTodayTextColor');

        // Formatting Settings
        containerEl.createEl('h3', {text: 'Formatting Settings'});

        new Setting(containerEl)
            .setName('Header Font Size')
            .setDesc('Set the font size for headers in the floating box')
            .addSlider(slider => slider
                .setLimits(2, 64, 1)
                .setValue(this.plugin.settings.headerFontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.headerFontSize = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateFloatingBoxStyle();
                    this.plugin.updateMinimumSize();
                }));

        new Setting(containerEl)
            .setName('Text Font Size')
            .setDesc('Set the font size for text in the floating box')
            .addSlider(slider => slider
                .setLimits(2, 64, 1)
                .setValue(this.plugin.settings.paragraphFontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.paragraphFontSize = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateFloatingBoxStyle();
                    this.plugin.updateMinimumSize();
                }));

        new Setting(containerEl)
            .setName('Padding')
            .setDesc('Set the padding for the floating box')
            .addSlider(slider => slider
                .setLimits(0, 64, 1)
                .setValue(this.plugin.settings.padding)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.padding = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateFloatingBoxStyle();
                    this.plugin.updateMinimumSize();
                }));

        new Setting(containerEl)
            .setName('Bold Today\'s Text')
            .setDesc('Make the text for Today\'s data bold in the floating box')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.todayTextBold)
                .onChange(async (value) => {
                    this.plugin.settings.todayTextBold = value;
                    await this.plugin.saveSettings();
                }));

        // Hotkeys
        containerEl.createEl('h3', {text: 'Hotkeys'});
        
        new Setting(containerEl)
            .setName('Resize Hotkey')
            .setDesc('Toggle resize mode with Command+R (default). You can change this in Obsidian Settings > Hotkeys.')
            .addButton(button => button
                .setButtonText('Go to Hotkeys')
                .onClick(() => {
                    (this.app as any).setting.openTabById('hotkeys');
                    const hotkeyEl = document.querySelector('.hotkey-search-container input');
                    if (hotkeyEl) {
                        (hotkeyEl as HTMLInputElement).value = 'Toggle Floating Box Resize Mode';
                        hotkeyEl.dispatchEvent(new Event('input'));
                    }
                }));

        new Setting(containerEl)
            .setName('Toggle Visibility')
            .setDesc('Toggle floating box visibility with Ctrl/Cmd+H (default)')
            .addButton(button => button
                .setButtonText('Go to Hotkeys')
                .onClick(() => {
                    (this.app as any).setting.openTabById('hotkeys');
                    const hotkeyEl = document.querySelector('.hotkey-search-container input');
                    if (hotkeyEl) {
                        (hotkeyEl as HTMLInputElement).value = 'Toggle Floating Box Visibility';
                        hotkeyEl.dispatchEvent(new Event('input'));
                    }
                }));

        new Setting(containerEl)
            .setName('Center Floating Box')
            .setDesc('Center the floating box with Ctrl/Cmd+J (default)')
            .addButton(button => button
                .setButtonText('Go to Hotkeys')
                .onClick(() => {
                    (this.app as any).setting.openTabById('hotkeys');
                    const hotkeyEl = document.querySelector('.hotkey-search-container input');
                    if (hotkeyEl) {
                        (hotkeyEl as HTMLInputElement).value = 'Center Floating Box';
                        hotkeyEl.dispatchEvent(new Event('input'));
                    }
                }));

        // New setting for displaying "Display As" text
        new Setting(containerEl)
            .setName('Show Display As Text')
            .setDesc('Show the "Display As" text in front of each data point')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showDisplayAsText)
                .onChange(async (value) => {
                    this.plugin.settings.showDisplayAsText = value;
                    await this.plugin.saveSettings();
                }));

        // Add the new setting for daily note end time
        new Setting(containerEl)
            .setName('Daily Note End Time')
            .setDesc('Set the time when the current day\'s note ends (e.g., 04:00 for 4:00 AM)')
            .addText(text => text
                .setPlaceholder('HH:mm')
                .setValue(this.plugin.settings.dailyNoteEndTime)
                .onChange(async (value) => {
                    // Validate the input
                    const isValid = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
                    if (isValid) {
                        this.plugin.settings.dailyNoteEndTime = value;
                        await this.plugin.saveSettings();
                    } else {
                        new Notice('Please enter a valid time in HH:mm format');
                    }
                }));
    }

    addColorSetting(containerEl: HTMLElement, name: string, colorSetting: 'backgroundColor' | 'textColor' | 'headerColor' | 'todayTextColor', customColorSetting: 'customBackgroundColor' | 'customTextColor' | 'customHeaderColor' | 'customTodayTextColor') {
        const colorOptions: Record<string, string> = colorSetting === 'backgroundColor' 
            ? {default: 'Default', secondary: 'Secondary', tertiary: 'Tertiary', custom: 'Custom Color Picker'}
            : {default: 'Default', muted: 'Muted', faint: 'Faint', accent: 'Accent', custom: 'Custom Color Picker'};

        const setting = new Setting(containerEl)
            .setName(name)
            .setDesc(`Set the ${colorSetting === 'backgroundColor' ? 'background' : colorSetting === 'textColor' ? 'text' : colorSetting === 'headerColor' ? 'header' : 'Today\'s text'} color of the floating box`)
            .addDropdown(dropdown => dropdown
                .addOptions(colorOptions)
                .setValue(this.plugin.settings[colorSetting])
                .onChange(async (value) => {
                    this.plugin.settings[colorSetting] = value;
                    await this.plugin.saveSettings();
                    this.updateColorSetting(setting, colorSetting, customColorSetting);
                }));

        this.updateColorSetting(setting, colorSetting, customColorSetting);
    }

    updateColorSetting(setting: Setting, colorSetting: 'backgroundColor' | 'textColor' | 'headerColor' | 'todayTextColor', customColorSetting: 'customBackgroundColor' | 'customTextColor' | 'customHeaderColor' | 'customTodayTextColor') {
        setting.components.slice(1).forEach(c => (c as any).settingEl?.remove());
        setting.components.splice(1);

        if (this.plugin.settings[colorSetting] === 'custom') {
            setting.addColorPicker(color => color
                .setValue(this.plugin.settings[customColorSetting] || (colorSetting === 'backgroundColor' ? '#ffffff' : '#000000'))
                .onChange(async (value) => {
                    this.plugin.settings[customColorSetting] = value;
                    await this.plugin.saveSettings();
                }))
            .addText(text => text
                .setPlaceholder('Custom color or CSS')
                .setValue(this.plugin.settings[customColorSetting])
                .onChange(async (value) => {
                    this.plugin.settings[customColorSetting] = value;
                    await this.plugin.saveSettings();
                }));
        }
    }

    createDataFieldSetting(container: HTMLElement, field: FloatingBoxSettings['dataFields'][0], index: number): void {
        const setting = new Setting(container);

        setting.addDropdown(dropdown => dropdown
            .addOptions({
                'dataview': 'DataView Field',
                'completedTasks': 'Completed Tasks',
                'uncompletedTasks': 'Uncompleted Tasks',
                'wordCount': 'Word Count',
                'lineBreak': 'Line Break',
                'dataviewjs': 'Custom DataviewJS Script'  // New option
            })
            .setValue(field.type)
            .onChange(async (value: 'dataview' | 'completedTasks' | 'uncompletedTasks' | 'wordCount' | 'lineBreak' | 'dataviewjs') => {
                this.plugin.settings.dataFields[index].type = value;
                await this.plugin.saveSettings();
                this.display(); // Refresh to show/hide dataview field input
            }));

        if (field.type !== 'lineBreak') {
            if (field.type === 'dataview') {
                setting.addText(text => text
                    .setPlaceholder('DataView Field Name')
                    .setValue(field.dataviewField || '')
                    .onChange(async (value) => {
                        this.plugin.settings.dataFields[index].dataviewField = value;
                        await this.plugin.saveSettings();
                    }));
            } else if (field.type === 'dataviewjs') {
                const scriptContainer = setting.settingEl.createDiv('dataviewjs-script-container');
                
                new Setting(scriptContainer)
                    .setDesc('Warning: Custom scripts can potentially harm your system. Only use scripts from trusted sources.');

                const textAreaContainer = scriptContainer.createDiv('dataviewjs-script-input');
                const textArea = new TextAreaComponent(textAreaContainer)
                    .setPlaceholder('Enter your DataviewJS script here')
                    .setValue(field.dataviewjsScript || '')
                    .onChange(async (value) => {
                        this.plugin.settings.dataFields[index].dataviewjsScript = value;
                        await this.plugin.saveSettings();
                    });

                textArea.inputEl.rows = 10;  // Set an initial number of rows
                textArea.inputEl.cols = 50;  // Set an initial number of columns
            }

            setting.addText(text => text
                .setPlaceholder('Display As')
                .setValue(field.displayName)
                .onChange(async (value) => {
                    this.plugin.settings.dataFields[index].displayName = value;
                    await this.plugin.saveSettings();
                }));

            setting.addToggle(toggle => toggle
                .setTooltip('Show in High Scores')
                .setValue(field.showInHighScores ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.dataFields[index].showInHighScores = value;
                    await this.plugin.saveSettings();
                }));

            setting.addText(text => text
                .setPlaceholder('Custom Override')
                .setValue(field.customOverride || '')
                .onChange(async (value) => {
                    this.plugin.settings.dataFields[index].customOverride = value || undefined;
                    await this.plugin.saveSettings();
                }));
        }

        setting.addButton(button => button
            .setIcon('trash')
            .onClick(async () => {
                this.plugin.settings.dataFields.splice(index, 1);
                await this.plugin.saveSettings();
                this.display(); // Refresh the entire settings tab
            }));
    }

    createTimePeriodSetting(container: HTMLElement, period: FloatingBoxSettings['customTimePeriods'][0], index: number): void {
        const setting = new Setting(container);

        setting.addText(text => text
            .setPlaceholder('Label (e.g., 30D Best)')  // Updated placeholder
            .setValue(period.label)
            .onChange(async (value) => {
                this.plugin.settings.customTimePeriods[index].label = value;
                await this.plugin.saveSettings();
            }));

        setting.addText(text => text
            .setPlaceholder('Value')
            .setValue(period.value.toString())
            .onChange(async (value) => {
                const numValue = parseInt(value);
                if (!isNaN(numValue)) {
                    this.plugin.settings.customTimePeriods[index].value = numValue;
                    await this.plugin.saveSettings();
                }
            }));

        setting.addDropdown(dropdown => dropdown
            .addOptions({
                'days': 'Days',
                'weeks': 'Weeks',
                'months': 'Months',
                'years': 'Years'
            })
            .setValue(period.unit)
            .onChange(async (value: 'days' | 'weeks' | 'months' | 'years') => {
                this.plugin.settings.customTimePeriods[index].unit = value;
                await this.plugin.saveSettings();
            }));

        // Add this new toggle
        setting.addToggle(toggle => toggle
            .setTooltip('Show Date')
            .setValue(period.showDate)
            .onChange(async (value) => {
                this.plugin.settings.customTimePeriods[index].showDate = value;
                await this.plugin.saveSettings();
            }));

        setting.addButton(button => button
            .setIcon('trash')
            .onClick(async () => {
                this.plugin.settings.customTimePeriods.splice(index, 1);
                await this.plugin.saveSettings();
                this.display(); // Refresh the entire settings tab
            }));
    }
}