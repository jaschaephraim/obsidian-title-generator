import {
  App,
  Editor,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from 'obsidian';
import OpenAI from 'openai';
import pMap from 'p-map';
import pathParse from 'path-parse';

interface TitleGeneratorSettings {
  openAiApiKey: string;
}

const DEFAULT_SETTINGS: TitleGeneratorSettings = {
  openAiApiKey: '',
};

class TitleGeneratorSettingTab extends PluginSettingTab {
  plugin: TitleGeneratorPlugin;

  constructor(app: App, plugin: TitleGeneratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('OpenAI API Key').addText((text) => {
      text.inputEl.type = 'password';
      text.inputEl.style.width = '100%';

      text
        .setPlaceholder('API Key')
        .setValue(this.plugin.settings.openAiApiKey)
        .onChange(async (newValue) => {
          this.plugin.settings.openAiApiKey = newValue;
          await this.plugin.saveSettings();
        });
    });
  }
}

class TitleGeneratorErrorModal extends Modal {
  private error: Error;

  constructor(app: App, error: Error) {
    super(app);
    this.error = error;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.setText(`Unable to generate title:\n\n${this.error.message}`);
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export default class TitleGeneratorPlugin extends Plugin {
  settings: TitleGeneratorSettings;

  openai: OpenAI;

  private async generateTitle(file: TFile, content: string) {
    const loadingStatus = this.addStatusBarItem();
    loadingStatus.createEl('span', { text: 'Generating title...' });

    try {
      const response = await this.openai.completions.create({
        model: 'gpt-3.5-turbo-instruct',
        prompt: `Given the following text:\n###\n${content}\n###\na succint, descriptive title would be: "`,
        stop: '"',
        logit_bias: {
          9: -100,
          59: -100,
          14: -100,
          27: -100,
          29: -100,
          25: -100,
          91: -100,
          30: -100,
        },
      });
      const title = response.choices[0].text.trim();

      const currentPath = pathParse(file.path);
      const newPath = `${currentPath.dir}/${title}${currentPath.ext}`;

      await this.app.fileManager.renameFile(file, newPath);
    } catch (err) {
      new TitleGeneratorErrorModal(this.app, err).open();
    } finally {
      loadingStatus.remove();
    }
  }

  private async generateTitleFromFile(file: TFile) {
    const content = await file.vault.cachedRead(file);
    return this.generateTitle(file, content);
  }

  private async generateTitleFromEditor(editor: Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    const content = editor.getValue();
    this.generateTitle(activeFile, content);
  }

  async onload() {
    await this.loadSettings();

    this.openai = new OpenAI({
      apiKey: this.settings.openAiApiKey,
      dangerouslyAllowBrowser: true,
    });

    this.addCommand({
      id: 'title-generator-generate-title',
      name: 'Generate title',
      checkCallback: (checking) => {
        const activeEditor = this.app.workspace.activeEditor?.editor;
        if (!activeEditor) {
          return false;
        }

        if (checking) {
          return true;
        }

        this.generateTitleFromEditor(activeEditor);
        return true;
      },
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile)) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Generate title')
            .setIcon('lucide-edit-3')
            .onClick(() => this.generateTitleFromFile(file));
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        const tFiles = files.filter((f) => f instanceof TFile) as TFile[];
        if (tFiles.length < 1) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Generate titles')
            .setIcon('lucide-edit-3')
            .onClick(() =>
              pMap(tFiles, (f) => this.generateTitleFromFile(f), {
                concurrency: 1,
              })
            );
        });
      })
    );

    this.addSettingTab(new TitleGeneratorSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.openai.apiKey = this.settings.openAiApiKey;
  }
}
