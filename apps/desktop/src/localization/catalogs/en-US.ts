import type { ZhCNTranslationCatalog } from "./zh-CN";

export const enUSTranslation = {
  app: {
    name: "Rino",
    title: "Rino",
  },
  common: {
    actions: {
      cancel: "Cancel",
      close: "Close",
      confirm: "Confirm",
      open: "Open",
      save: "Save",
      search: "Search",
      settings: "Settings",
      collapse: "Collapse",
      expand: "Expand",
      run: "Run",
      stop: "Stop",
    },
  },
  shell: {
    project: {
      noProject: "No project open",
      noProjectDescription:
        "Open or create a project to see graphs and assets here.",
    },
    device: {
      disconnected: "No device connected",
      disconnectedShort: "Device disconnected",
      disconnectedDescription:
        "Connect an Android device or emulator to view its live screen.",
      previewLabel: "Device screen",
      resolution: "Resolution",
      scaleFactor: "Interface scale",
      capture: "Capture screen",
      captureDescription: "Get a new preview image from the current device.",
      pause: "Pause preview",
      connect: "Connect device",
      disconnect: "Disconnect device",
      selectorLabel: "Device",
      noDevices: "No device found",
      backendUnavailable: "Device backend is not configured",
      backendUnavailableDescription:
        "The runtime has no local ADB backend, so Android devices cannot be discovered or connected.",
      refreshDevices: "Refresh device list",
      readyToCapture: "Device connected",
      readyToCaptureDescription:
        "Use the refresh button to get the current device screen.",
      previewError: "Device preview unavailable",
      previewErrorDescription: "Check the device connection and try again.",
      phase: {
        loadingDevices: "Finding devices",
        connecting: "Connecting device",
        capturing: "Capturing screen",
        controlling: "Sending device action",
      },
      previewRefresh: {
        pause: "Pause preview",
        resume: "Resume preview",
        pausedLabel: "Paused",
        frameRate: "Refresh rate",
        framesPerSecond: "{{count}} FPS",
        status: {
          live: "Live preview",
          paused: "Preview paused",
          stale: "Frame may be out of date",
        },
        announcements: {
          paused: "Device preview paused.",
          resumed: "Device preview resumed.",
        },
      },
      control: {
        enable: "Control device",
        disable: "Exit control",
        surfaceLabel: "Direct device control surface",
        failure:
          "The device action could not be confirmed. Check the connection; the action will not be retried automatically.",
        announcements: {
          enabled:
            "Device control enabled. Click to tap, drag to swipe, or hold to long press.",
          disabled: "Device control disabled.",
          click: "Device click completed.",
          longPress: "Device long press completed.",
          swipe: "Device swipe completed.",
          back: "Back was sent to the device.",
        },
      },
      expandedPreview: {
        open: "Enlarge preview",
        close: "Close enlarged preview",
        title: "Enlarged device preview",
        description:
          "View and control the current device in a centered large preview. Press Escape to go back on the device.",
      },
      independentWindow: {
        open: "Open device preview in a separate window",
        unavailable:
          "Separate preview is available from the desktop main window only",
        failure: "The separate preview window could not be opened. Try again.",
        title: "Separate device preview",
        close: "Close separate device preview",
        waitingTitle: "Waiting for a device frame",
        waitingDescription:
          "The next device frame captured by the main window will appear here.",
        readFailure:
          "The current device frame could not be read. The next frame from the main window will retry automatically.",
      },
      captureWorkbench: {
        fullFrame: "Capture full screen",
        region: "Capture region",
        cancelRegion: "Cancel region selection",
        title: "Confirm Captured Asset",
        nameLabel: "Asset display name",
        namePlaceholder: "Enter asset name",
        nameHint:
          "A unique default name is ready. Save it as-is or enter a more recognizable name.",
        dimensions: "Dimensions",
        origin: "Origin",
        fullFrameOrigin: "Full screen",
        regionOrigin: "Region (X: {{x}}, Y: {{y}})",
        regionOriginUnknown: "Region capture",
        nameValid: "Name is available",
        nameConflict: "Asset display name conflicts with an existing asset",
        suggestionAction: "Use suggestion: {{suggestion}}",
        actions: {
          confirm: "Save Asset",
          retrySave: "Retry Save",
          discard: "Discard",
          close: "Close",
          reset: "Done",
        },
        steps: {
          preparing: "Preparing capture frame...",
          storing: "Storing binary data...",
          filing: "Filing asset metadata...",
          saving: "Saving project file...",
        },
        completed: "Capture saved to project successfully",
        saveFailedTitle: "Failed to save project file",
        saveFailedDescription:
          "Asset metadata filed in memory. Click retry to save to disk.",
        filingFailedTitle: "Failed to file asset metadata",
        nameErrors: {
          empty: "Asset display name cannot be empty",
          tooLong: "Asset display name cannot exceed 200 characters",
          controlCharacter:
            "Asset display name contains illegal control characters",
          pathSeparator: "Asset display name cannot contain slashes",
          trailingPeriod: "Asset display name cannot end with a period",
          reservedName: "Asset display name is a reserved system name",
          collision: "Asset display name conflicts with an existing asset",
        },
        failures: {
          preview: {
            runtimeCapture:
              "Could not obtain a new capture frame from the device.",
            previewRead:
              "The device frame was received, but the desktop could not read the preview data.",
            previewValidation:
              "The device frame became stale or contained incomplete data.",
            previewPresentation:
              "The device frame was read, but the interface could not display it.",
          },
          noOpenProject: "No project open. Cannot save capture.",
          projectChanged:
            "Project changed during capture. Capture was not saved.",
          executionLocked: "Project graph is currently running or locked.",
          stalePreview:
            "Preview frame changed. Cannot complete capture from stale frame.",
          namePreparationFailed:
            "Failed to generate a capture name. Check the current project data and try again.",
          runtimePrepareFailed:
            "The device frame was received, but the runtime could not create the capture.",
          captureReadFailed:
            "The capture was created, but the desktop could not read its data.",
          previewCreationFailed:
            "The capture was read, but the naming confirmation could not be opened.",
          prepareFailed: "Failed to prepare capture frame. Please try again.",
          storedMetadataMismatch: "Stored metadata mismatch.",
          documentRejected: "Asset metadata rejected by project document.",
          saveFailed: "Failed to save project file.",
        },
        diagnosticCode: "Error code: {{code}}",
        regionOverlay: {
          title: "Capture region selector",
          instructions:
            "Drag on screen or use arrow keys to select capture area. Press Enter to commit, Esc to cancel.",
          announcements: {
            started:
              "Region capture mode active. Drag or use arrow keys to select area.",
            cancelled: "Region selection cancelled.",
            accepted: "Selected area {{w}} × {{h}}. Preparing capture...",
            readyForName:
              "The region capture is ready. Confirm the automatic name or enter a custom name.",
          },
        },
      },
      coordinatePicker: {
        selectPoint: "Pick point from screen",
        reselectPoint: "Repick point from screen",
        selectQuickClick: "Quick click: pick from screen",
        reselectQuickClick: "Reset quick-click point",
        selectRectangle: "Select region from screen",
        reselectRectangle: "Reselect region from screen",
        cancel: "Cancel selection",
        pointInstruction:
          "Click on the screen to confirm coordinates. Press Enter to commit, Esc to cancel.",
        rectangleInstruction:
          "Drag on the screen to select a rectangle. Press Enter to commit, Esc to cancel.",
        keyboardHint:
          "Arrow keys to move, Shift+Arrows for larger steps, Enter to commit, Esc to cancel.",
        mismatchWarning:
          "Screen resolution ({{currentWidth}} × {{currentHeight}}) does not match the reference resolution ({{refWidth}} × {{refHeight}}). Reselect coordinates to unlock graph execution.",
        selectedSummaryPoint: "Saved point: X {{x}}, Y {{y}}",
        selectedSummaryRect: "Saved region: X {{x}}, Y {{y}}, {{w}} × {{h}}",
        unselectedSummaryPoint: "No point selected",
        unselectedSummaryRect: "No region selected",
        requiresDevice:
          "Connect a device and capture a screen to select coordinates.",
        requiresFrame: "Preview frame is not ready yet.",
        announcements: {
          pointStarted:
            "Point picker active. Click on screen or use arrow keys to pick location.",
          rectangleStarted:
            "Rectangle picker active. Drag on screen or use arrow keys to select area.",
          cancelled: "Selection cancelled. Graph remains unchanged.",
          pointCommitted: "Updated point coordinates to X {{x}}, Y {{y}}.",
          rectangleCommitted:
            "Updated rectangle area to X {{x}}, Y {{y}}, width {{width}}, height {{height}}.",
          staleFrame: "Preview frame changed; selection cancelled.",
          mismatch:
            "Warning: Displayed screen resolution differs from reference resolution.",
          invalidGesture:
            "Selection falls outside valid image bounds. Please try again.",
          editLocked: "Graph execution is locked or graph cannot be edited.",
          commandRejected: "Failed to update coordinate command.",
        },
        aria: {
          interactionSurface: "Device preview coordinate editor surface",
          interactionDescription:
            "Use mouse or arrow keys to position coordinates. Press Enter or Space to commit, Escape to cancel.",
        },
      },
    },
    toolbar: {
      regionLabel: "Application toolbar",
      runGraph: "Run graph",
      stopGraph: "Stop run",
      openSettings: "Open settings",
      unavailableWithoutProject: "Open a project first.",
      unavailableWithoutDevice: "Open a project and connect a device first.",
      unavailableWithoutRun: "No graph is currently running.",
      runUnavailable: "The runtime is not ready to run this graph.",
      runAlreadyActive: "A graph is already running.",
    },
    tasks: {
      switcherLabel: "Switch task",
      noTask: "No task selected",
      manage: "Manage tasks",
      taskSettings: {
        open: "Open current task settings",
        title: "Current task settings",
        description:
          "These options come from choice nodes in the current task and are saved in the graph with Undo support.",
        empty: "This task has no regular settings exposed in the top bar.",
        locked: "The task is running, so settings are temporarily read-only.",
        invalid:
          "This settings node is invalid. Inspect its choices on the canvas.",
        unmatched:
          "The selected case is no longer available; the unmatched branch will continue.",
        settingLabel: "Setting {{name}}",
      },
      activeBadge: "Current",
      defaultBadge: "Default",
      runningBadge: "Running",
      managementTitle: "Task management",
      managementDescription:
        "Switch, create, and organize the tasks in this project. Tasks are saved in list order.",
      lockedDescription:
        "A task is running, so task switching and management are temporarily unavailable.",
      listLabel: "Project task list",
      renameLabel: "Rename task: {{name}}",
      duplicateTask: "Duplicate task: {{name}}",
      renameTask: "Rename task: {{name}}",
      deleteTask: "Delete task: {{name}}",
      duplicate: "Duplicate",
      rename: "Rename",
      delete: "Delete",
      setDefault: "Set default",
      deleteConfirm: "Delete “{{name}}”? You can restore this with Undo.",
      copyName: "{{name}} copy",
      createLabel: "New task",
      createHint: "The new task starts empty and becomes the active task.",
      createPlaceholder: "Enter a task name",
      create: "Create",
      onlyTaskNote:
        "A project must keep at least one task. Create or duplicate another task before deleting this one.",
      errors: {
        taskNameInvalid:
          "A task name is required and may not exceed 200 characters.",
        taskLimitReached: "The task limit has been reached.",
        cannotDeleteOnlyTask: "A project must keep at least one task.",
        taskMissing:
          "That task no longer exists; it may have been removed elsewhere.",
        executionLocked: "A task is running, so this action is locked.",
        noDocument: "Open or create a project first.",
        commandRejected:
          "The task change could not be written to the project. Try again.",
      },
    },
    palette: {
      regionLabel: "Node library panel region",
      title: "Node library",
      searchPlaceholder: "Search nodes in Chinese or English",
      searchLabel: "Search nodes",
      emptyTitle: "Node registry is not loaded",
      emptyDescription:
        "After the runtime connects, available nodes can be searched and dragged from here.",
      open: "Open node library",
    },
    canvas: {
      workspaceLabel: "Graph editing workspace",
      label: "Graph editor canvas",
      emptyTitle: "Start with a project",
      emptyDescription:
        "Open a project, then drag nodes from the library and connect the execution flow.",
    },
    workbench: {
      regionLabel: "Device and inspector workbench region",
      title: "Workbench",
      open: "Open workbench",
      device: "Device",
      inspector: "Inspector",
      functions: "Functions",
      variables: "Project variables",
      float: "Float workbench",
      dock: "Dock workbench",
      drag: "Drag workbench",
      resize: "Resize workbench",
      contextMenuLabel: "Workbench layout actions",
      inspectorEmptyTitle: "No node selected",
      inspectorEmptyDescription:
        "Select a node on the canvas to edit parameters and inspect validation.",
    },
    screenshotBrowser: {
      open: "Open screenshot library",
      openDescription:
        "Browse project screenshots and drag them onto the canvas.",
      title: "Screenshot library",
      description:
        "Dragging a screenshot onto the canvas creates an image node bound to that asset.",
      searchLabel: "Search screenshots",
      searchPlaceholder: "Search screenshots by name",
      emptyTitle: "No screenshots yet",
      emptyDescription:
        "Capture a full frame or region in the workbench to add it here.",
      noResultsTitle: "No matching screenshots",
      noResultsDescription: "Try another name.",
      dragHint: "Drag {{name}} onto the canvas",
      sortLabel: "Screenshot sort order",
      sortAddedTime: "Date added",
      sortName: "Name",
      viewLabel: "Screenshot preview style",
      gridView: "Image preview",
      listView: "List preview",
      previewUnavailable: "This screenshot preview could not be loaded",
    },
    debug: {
      title: "Debug",
      problems: "Problems",
      logs: "Logs",
      values: "Values",
      ocr: "OCR",
      execution: "Execution",
      breakpoints: "Breakpoints",
      empty: {
        logs: { title: "No logs yet" },
        values: { title: "No values yet" },
        ocr: { title: "No OCR results yet" },
        execution: { title: "No execution history yet" },
        breakpoints: { title: "No breakpoints yet" },
      },
      emptyDescription:
        "Related debug information appears here after a graph is opened and run.",
    },
    resize: {
      palette: "Resize node library",
      workbench: "Resize workbench",
      debug: "Resize debug panel",
      preview: "Resize device preview and inspector",
    },
    settings: {
      title: "Settings",
      description: "Manage appearance, performance, shortcuts, and local data.",
      navigationLabel: "Settings categories",
      sections: {
        appearance: "Appearance",
        performance: "Performance",
        shortcuts: "Shortcuts",
        data: "Data",
      },
      appearanceTitle: "Appearance",
      appearanceDescription:
        "Adjust the application theme and interface language.",
      shortcutsTitle: "Keyboard shortcut reference",
      shortcutsDescription: "Search commands, keys, or scope.",
      searchShortcuts: "Search shortcuts",
      command: "Command",
      keys: "Keys",
      scope: "Scope",
      status: "Status",
      available: "Available",
      unavailable: "Not connected",
      noShortcutResults: "No matching shortcuts.",
      resetAllShortcuts: "Reset all shortcuts",
      resetSingle: "Reset",
      resetToDefault: "Reset to default",
      clickToChangeShortcut: "Click to change shortcut",
      recordingPrompt: "Press hotkey...",
      conflictWarning: "Shortcut conflicts with '{{other}}'",
      performanceTitle: "Performance",
      performanceDescription:
        "Tune canvas responsiveness and local preview load.",
      resourceProfile: "CPU and memory resource profile",
      resourceProfileDescription:
        "Adjusts visible-node culling, wheel response, and the suggested preview rate without changing device-operation ordering.",
      performanceProfiles: {
        responsive: "Responsive",
        balanced: "Balanced",
        efficiency: "Efficiency",
      },
      uiRefreshRate: "UI animation refresh-rate limit",
      uiRefreshRateDescription:
        "Controls canvas animation, pointer overlays, and runtime-status presentation. The actual rate never exceeds the display or WebView, and this does not change device preview or execution speed.",
      uiRefreshRateOptions: {
        display: "Follow display",
        "60": "60 Hz",
        "120": "120 Hz",
        "180": "180 Hz",
      },
      previewRefreshRate: "Device preview frame rate",
      previewRefreshRateDescription:
        "Higher rates feel smoother but use more capture, CPU, and memory bandwidth.",
      framesPerSecond: "{{count}} FPS",
      hardwareAcceleration: "Hardware acceleration",
      hardwareAccelerationAutomatic: "System automatic",
      hardwareAccelerationDescription:
        "Desktop rendering automatically uses GPU composition when the system provides it; video memory does not need manual allocation.",
      dataTitle: "Data",
      dataDescription:
        "Review application data kept on this device and the identity used for project naming.",
      installationCode: "Installation code",
      installationCodeDescription:
        "Created on first use. New captures use this code in their internal names so same-named assets from different installations remain distinct.",
      installationCodeUnavailable: "Unavailable",
      assetNameExample: "Internal name example: {{code}}_exit-button_01",
      storageStatus: {
        stored: "Stored on this device",
        memoryOnly: "Temporary for this session",
      },
      localDataTitle: "Data scope",
      interfaceData: "Interface and performance preferences",
      shortcutData: "Custom keyboard shortcuts",
      assetNamingData: "Asset naming ordinals",
      assetNamingRecordCount: "{{count}} name records",
      projectData: "Projects, graphs, and captured assets",
      localOnly: "Stored only on this device",
      projectFolder: "Stored in the project folder selected by the user",
      installationCodePrivacy:
        "The code is not an account or secret and is never sent online by the application. It is included in new assets' internal names and may travel with a shared project.",
      persistentVariablesTitle: "Persistent variable data",
      persistentVariablesDescription:
        "Manage values saved across task runs; variable definitions and nodes remain in the project graph.",
      persistentVariablesStoredLocally: "Application data on this device",
      persistentVariablesProjectCount: "Saved projects",
      persistentVariablesValueCount: "All persistent variable values",
      persistentVariablesCurrentCount: "Persistent values in the open project",
      persistentVariablesLocalOnlyNote:
        "These values exist only in local application data. They are not written to project files or export packages.",
      clearCurrentPersistentVariables: "Clear current project",
      clearAllPersistentVariables: "Clear all",
      persistentVariablesConfirmCurrentTitle:
        "Clear persistent values for the current project?",
      persistentVariablesConfirmAllTitle:
        "Clear all persistent variable values?",
      persistentVariablesConfirmCurrentDescription:
        "Only saved persistent values for the open project will be deleted.",
      persistentVariablesConfirmAllDescription:
        "Saved persistent values for every project will be deleted from local application data.",
      persistentVariablesConfirmDetails:
        "Variable definitions, variable nodes, project graphs, captured assets, the installation code, and asset naming ordinals will not be deleted. This cannot be undone.",
      persistentVariablesConfirmAction: "Confirm clear",
      persistentVariablesClearSuccessCurrent:
        "Saved persistent values for the current project were cleared.",
      persistentVariablesClearSuccessAll:
        "Saved persistent values for all projects were cleared.",
      persistentVariablesClearMemoryOnly:
        "Cleared for this session, but local storage is not writable. Old values may return after the next launch.",
      persistentVariablesClearFailure:
        "Persistent variable values could not be cleared. Check local application data and try again.",
      scopes: {
        global: "Global",
        canvas: "Canvas",
        runtime: "Runtime",
      },
    },
    shortcuts: {
      openReference: {
        label: "Open shortcut reference",
        description: "Show the searchable shortcut list.",
      },
      focusPalette: {
        label: "Search nodes",
        description: "Focus the node library search field.",
      },
      focusDevice: {
        label: "Open device workbench",
        description: "Show the device screen area.",
      },
      save: {
        label: "Save project",
        description: "Save changes to the current project.",
      },
      saveAs: {
        label: "Save project as",
        description: "Save the current project to a new location.",
      },
      undo: { label: "Undo", description: "Undo the last graph edit." },
      redo: {
        label: "Redo",
        description: "Restore the last undone graph edit.",
      },
      copy: { label: "Copy nodes", description: "Copy selected nodes." },
      paste: {
        label: "Paste nodes",
        description: "Paste nodes onto the canvas.",
      },
      duplicate: {
        label: "Duplicate selection",
        description: "Copy and place selected nodes.",
      },
      remove: {
        label: "Delete selection",
        description: "Delete selected nodes or edges.",
      },
      addNode: {
        label: "Quick add node",
        description: "Open node search on the canvas.",
      },
      comment: {
        label: "Create area comment",
        description:
          "Create a comment around selected nodes or drag a comment region on the canvas.",
      },
      commandPalette: {
        label: "Command search",
        description: "Search global commands and nodes.",
      },
      frameSelection: {
        label: "Frame selection",
        description: "Fit selected nodes into the canvas viewport.",
      },
      frameGraph: {
        label: "Frame graph",
        description: "Fit the complete graph into the canvas viewport.",
      },
      run: { label: "Run graph", description: "Run the current graph." },
      stop: { label: "Stop run", description: "Cancel the current run." },
      breakpoint: {
        label: "Toggle breakpoint",
        description: "Toggle a breakpoint on selected nodes.",
      },
      stepOver: {
        label: "Step over",
        description: "Execute the current node and pause at the next node.",
      },
      continueRun: {
        label: "Continue run",
        description: "Continue execution from a paused position.",
      },
    },
  },
  graph: {
    canvas: {
      label: "Node graph",
      surfaceLabel: "Node graph editing surface",
      dropInvalid: "This drag payload is invalid and was not inserted.",
    },
    project: {
      defaultGraphName: "Main graph",
    },
    function: {
      navigation: {
        label: "Function navigation",
        prefix: "Function",
        back: "Back to parent",
      },
      library: {
        title: "Functions",
        count: "{{count}} functions",
        defaultName: "Function {{count}}",
        create: "New function",
        noProject: "Open a project to create functions.",
        empty: "No function graphs yet.",
        insertCall: "Insert call",
        insertCallFor: "Insert a call to {{name}}",
        selfCallDisabled: "A function cannot insert a call to itself",
        edit: "Edit function",
        editFor: "Edit function {{name}}",
        dragHint: "Drag {{name}} to the canvas to insert a function call.",
        dragDisabled:
          "Function dragging is unavailable while the project is running or no graph is open.",
        errors: {
          noProject: "Open or create a project first.",
          operationFailed: "The function operation failed. Check the graph.",
          commandRejected: "The function operation could not be saved.",
          limit: "The function or parameter limit has been reached.",
          name: "The function name is invalid or already in use.",
          target:
            "The function call target is missing or is not a function graph.",
          self: "A function cannot call itself.",
          recursion:
            "The function call would create direct or indirect recursion.",
          depth: "Function call depth cannot exceed 16 frames.",
        },
      },
      signature: {
        title: "Function signature",
        description: "Edit the function name, input parameters, and outputs.",
        nameLabel: "Function name",
        namePlaceholder: "Enter a function name",
        input: "Input",
        output: "Output",
        parameterName: "{{label}} parameter name",
        parameterType: "{{label}} parameter type",
        removeParameter: "Remove parameter",
        removeParameterFor: "Remove {{label}} parameter",
        parameterCount: "{{count}} / {{maximum}}",
        noParameters: "No parameters",
        addInput: "Add input",
        addOutput: "Add output",
        defaultInputName: "Input {{count}}",
        defaultOutputName: "Output {{count}}",
        missing: "The function signature is unavailable.",
        types: {
          bool: "Boolean",
          number: "Number",
          string: "Text",
          point: "Point",
          rect: "Region",
          imageRef: "Image",
        },
        errors: {
          operationFailed:
            "The parameter operation failed. Check the signature.",
          commandRejected: "The parameter change could not be saved.",
          limit: "Each direction can contain at most 16 parameters.",
          name: "A parameter name is required, unique, and at most 80 characters.",
          kind: "That parameter type is not supported.",
          parameterMissing:
            "The parameter no longer exists; it may have been edited elsewhere.",
        },
      },
    },
    variable: {
      selectLabel: "Variable",
      nameLabel: "Variable name",
      persistentLabel: "Keep across task runs",
      create: "Create same-kind variable",
      missing: "Variable not found",
      noOptions: "No same-kind variables",
      updateFailed:
        "Variable change failed. Check the name and persistence setting.",
      createFailed: "Could not create a variable for this graph.",
      library: {
        count: "{{count}} variables",
        item: "{{name}} · {{type}}",
        create: "Create variable",
        createType: "New variable type",
        createName: "New variable name",
        createNamePlaceholder: "Leave blank for an automatic name",
        select: "Select project variable",
        selected: "Selected project variable",
        type: "Variable type",
        sharedDescription:
          "This definition is shared by every task and function in the project.",
        noProject: "Open or create a project to manage shared variables.",
        noActiveGraph:
          "Open a task or function graph before creating or editing variables.",
        executionLocked:
          "Variable editing is locked while the project is running.",
        empty: "This project has no shared variables yet.",
        typeLocked:
          "This variable is referenced by a task or function node, so its type cannot be changed.",
        deleteLocked:
          "This variable is referenced by a task or function node, so it cannot be deleted.",
        imagePersistentDisabled:
          "Image variables cannot be kept across task runs.",
        createFailed: "Could not create the project variable. Check its name.",
        updateFailed:
          "Could not update the project variable. Check its name and type.",
        dragHint: "Drag {{name}} to the canvas to insert a variable node.",
        dragDisabled:
          "Variable dragging is unavailable while the project is running or no graph is open.",
        delete: "Delete variable",
        insertGetter: "Insert get variable",
        insertSetter: "Insert set variable",
        insertMenuLabel: "Choose a variable node",
        insertFailed:
          "Could not insert the variable node into the active graph.",
        types: {
          bool: "Boolean",
          number: "Number",
          string: "Text",
          point: "Point",
          rect: "Region",
          imageRef: "Image",
        },
      },
    },
    node: {
      breakpoint: "Breakpoint set",
      disabled: "Disabled",
      runtime: {
        running: "Running",
        succeeded: "Succeeded",
        failed: "Failed",
      },
      unresolvedTitle: "Unknown node: {{typeKey}}",
      unresolvedDescription:
        "The active registry has no such node type. Its content is preserved unchanged.",
      inlineFieldLabel: "{{port}} input value of {{node}}",
      aliasEditHint: "Double-click the {{node}} title to add or edit its alias",
      aliasInputLabel: "Alias for {{node}}",
      aliasPlaceholder: "Add alias",
      longAliasLabel: "Node note",
      moreParameters: "More parameters",
      quickPick: "Pick from emulator",
      log: {
        segmentText: "Text",
        segmentTextDescription:
          "Appends this segment as a text value to the log message.",
        segmentNumber: "Number",
        segmentNumberDescription:
          "Appends this segment using number formatting to the log message.",
        addSegment: "Add segment",
        removeSegment: "Remove segment",
        appendNewline: "Append newline",
      },
      sequence: {
        addStep: "Add step",
        addStepFailed: "Could not add the sequence step",
        stepLimit: "A maximum of {{count}} steps is available",
        orderEditor: "Execution order",
        step: "Step {{count}}",
        moveUp: "Move step {{step}} up (current position {{position}})",
        moveDown: "Move step {{step}} down (current position {{position}})",
      },
      dynamic: {
        addBranch: "Add parallel path",
        addInput: "Add numeric input",
        addImage: "Add image",
        addRegion: "Add recognition region",
        addPoint: "Add click point",
        addFailed: "Could not add the dynamic port",
        removeItem: "Remove item {{item}}",
        removeFailed: "Could not remove the last item",
      },
    },
    port: {
      required: "Required input",
      connected: "From connection",
      groupBoundary: "Workflow node port",
      type: {
        execution: "Execution",
        boolean: "Boolean",
        number: "Number",
        string: "Text",
        image: "Image",
        point: "Point",
        rect: "Region",
        ocrCandidate: "OCR candidate",
        ocrResult: "Recognition result",
        collectionCompact: "List",
        collectionFull: "{{type}} list",
        optionalCompact: "Optional",
        optionalFull: "Optional {{type}}",
        unknown: "Unknown type",
      },
      description: {
        ocrMatched:
          "True when at least one text candidate reaches the confidence threshold.",
        matchMatched:
          "True when at least one region reaches the matching threshold.",
        recognitionResult:
          "Contains text candidates, confidence, and regions for the text readers.",
        bestText: "The current highest-confidence text candidate.",
        bestRegion: "The screen region containing the current best candidate.",
        regionCollection: "All matching regions in recognition order.",
        metricCollection:
          "Scores, feature counts, or pixel counts in matching order.",
        normalizedText:
          "Text normalized by the number-format rules for logging or later parsing.",
        selectedCandidate:
          "The candidate selected by its index and reading order.",
        missingCandidate:
          "Used when the requested index is beyond the available candidates.",
        invalidNumber:
          "The selected text exists but cannot be parsed as a finite number.",
        recognitionRegion:
          "Limits recognition or matching to a screen region; otherwise the full screen is used.",
        templateImage: "The project image used as the matching template.",
      },
      inputLabel: "Input port {{port}} of {{node}}, type {{type}}",
      outputLabel: "Output port {{port}} of {{node}}, type {{type}}",
      connectionGestureHint:
        "Alt + left click disconnects every wire on this port. Ctrl + left drag to a matching-side port moves every wire.",
    },
    edge: {
      executionDescription: "Execution connection",
      dataDescription: "Data connection, type {{type}}",
    },
    comment: {
      defaultText: "Comment",
      textLabel: "Area comment text",
      remove: "Remove area comment",
      resize: "Resize area comment",
    },
    connection: {
      retargetRejected:
        "Cannot move wires: the destination port is incompatible with the existing wires",
      rejected: {
        nodeMissing: "Cannot connect: the node does not exist",
        portMissing: "Cannot connect: the port does not exist",
        portDirectionMismatch:
          "Cannot connect: a connection runs from an output to an input",
        portKindMismatch:
          "Cannot connect: execution and data ports cannot be joined",
        typeIncompatible: "Cannot connect: the port types are not compatible",
        selfConnection: "Cannot connect: a node cannot connect to itself",
        duplicateConnection: "Cannot connect: this connection already exists",
        wouldCreateDataCycle:
          "Cannot connect: this would create a cycle between pure nodes",
        wouldCreateMultipleParallelOnPath:
          "Cannot connect: an execution path cannot pass through parallel twice",
      },
    },
    history: {
      moveNode: "Move node",
      moveNodes: "Move nodes",
      moveRepeatHint: "Move repeat hint",
      resolveNodeOverlaps: "Resolve overlapping nodes",
      connect: "Create connection",
      reconnectEdge: "Reconnect wire",
      disconnectPort: "Disconnect port wires",
      retargetPortConnections: "Move port wires",
      insertNode: "Add node",
      insertTemplate: "Insert workflow template",
      removeSelection: "Delete selection",
      paste: "Paste",
      duplicate: "Duplicate",
      setProperty: "Edit property",
      resetProperty: "Reset property to default",
      setInputValue: "Edit input value",
      clearInputValue: "Clear input value",
      setAlias: "Rename node alias",
      setVariable: "Edit variable",
      addSequenceStep: "Add sequence step",
      moveSequenceStep: "Reorder sequence step",
      addComment: "Add area comment",
      editComment: "Edit area comment",
      removeComment: "Remove area comment",
      addRepeatHint: "Add repeat hint",
      setWorkflowGroupCollapsed: "Collapse or expand workflow node",
      setRecognitionMethod: "Change image recognition method",
      setClickMethod: "Change text recognition click method",
      promoteInput: "Extract input parameter",
      createFunction: "Create function",
      insertFunctionCall: "Insert function call",
      renameFunction: "Rename function",
      addFunctionParameter: "Add function parameter",
      renameFunctionParameter: "Rename function parameter",
      changeFunctionParameterKind: "Change function parameter type",
      removeFunctionParameter: "Remove function parameter",
    },
    inspector: {
      alias: "Alias",
      aliasHelp:
        "Affects the canvas label only; it never changes the node type, its ports, or how it runs.",
      properties: "Properties",
      inputs: "Inputs",
      noProperties: "This node has no configurable properties.",
      noInputs: "This node has no data inputs.",
      required: "Required",
      resetToDefault: "Reset to default",
      resetToDefaultHelp: "Return to the definition's default value {{value}}.",
      drivenByConnection:
        "A connection supplies this input, so the inline value is not used.",
      literalNotAccepted:
        "This input accepts a connection only, not an inline value.",
      storedProperties: "Stored properties",
      storedInputValues: "Stored inline input values",
      hiddenProperties:
        "The definition declares {{count}} more properties than can be shown; their values are preserved.",
      multipleSelectedTitle: "Several nodes selected",
      multipleSelectedDescription:
        "{{count}} nodes are selected. Select a single node to edit its properties.",
      ocr: {
        title: "OCR overview",
        methodLabel: "Recognition method",
        methodValue: "Common Chinese and English text",
        methodDescription:
          "Uses the safe OCR capability provided by the runtime.",
        roiLabel: "Recognition region",
        roiConnected: "Supplied by the ROI connection",
        roiFullImage: "Entire image",
        confidenceLabel: "Minimum confidence",
        confidenceDescription:
          "Candidates below this threshold are not accepted.",
        confidenceUnavailable: "Configuration unavailable",
        result: {
          title: "Latest result",
          idleTitle: "Not run yet",
          idleDescription:
            "Run this graph to see this node's bounded result summary.",
          runningTitle: "Recognizing text",
          runningDescription: "Processing the current image.",
          matchedTitle: "Text recognized",
          matchedDescription:
            "The highest-confidence candidate is shown below.",
          noMatchTitle: "No text recognized",
          noMatchDescription:
            "No text candidate in the image met the conditions.",
          incompleteTitle: "Result summary incomplete",
          incompleteDescription:
            "The runtime did not return a complete OCR summary. Review the run log.",
          failedTitle: "Text recognition failed",
          failedDescription:
            "The node failed. Check the device state and run log.",
          candidateCount: "Candidates",
          bestText: "Best text",
          bestRect: "Region",
          truncated: "The content is long; a bounded summary is shown.",
        },
      },
      help: {
        type: "Type: {{type}}",
        default: "Default: {{value}}",
        range: "Accepted range: {{minimum}} to {{maximum}}",
        minimum: "Minimum: {{minimum}}",
        maximum: "Maximum: {{maximum}}",
      },
      validation: {
        required: "This field cannot be empty.",
        notANumber: "Enter a number.",
        notAnInteger: "Enter a whole number.",
        tooSmall: "Cannot be smaller than {{minimum}}.",
        tooLarge: "Cannot be larger than {{maximum}}.",
        tooShort: "Must be at least {{minimum}} characters.",
        tooLong: "Cannot be longer than {{maximum}} characters.",
        notAChoice: "Choose one of the listed options.",
        notEditable: "This value cannot be edited here.",
        storedValueMismatch:
          "The stored value does not match this field's type. Set it again.",
      },
      unsupported: {
        typeUnsupported:
          "This property type has no editor in this version. Its value is preserved.",
        labelMissing:
          "This property has no name metadata, so it cannot be edited safely. Its value is preserved.",
        choicesInvalid:
          "This property's options have no name metadata, so it cannot be edited safely. Its value is preserved.",
        declarationInvalid:
          "The property declaration in this node definition cannot be read. Stored values are preserved.",
      },
      numericWorkflow: {
        invalidStoredValue: "Invalid stored value",
        parseNumber: {
          title: "Number format",
          decimalSeparator: "Decimal separator: {{separator}}",
          groupingSeparator: "Grouping separator: {{separator}}",
          noGrouping: "Grouping separator: None",
          invalidSetting: "Invalid format setting",
          sampleUnavailable: "Sample unavailable",
          allowSign: "Allow sign",
          normalizeFullWidth: "Full-width normalized",
          minimum: "Min: {{value}}",
          maximum: "Max: {{value}}",
          outcomesTitle: "Parse outcomes",
          parsedOutcome: "Parsed",
          invalidOutcome: "Invalid",
          equalSeparatorsWarning:
            "Decimal and grouping separators cannot be identical.",
          reversedBoundsWarning: "Minimum bound cannot exceed maximum bound.",
          invalidConfigurationWarning:
            "Some stored format settings are invalid. Correct them in Properties before running.",
        },
        numberCompare: {
          title: "Comparison",
          connected: "From connection",
          required: "Value required",
          resultTitle: "Result",
          unsupportedOperator: "Unsupported operator: {{operator}}",
          operatorNames: {
            greaterThan: "Left is greater than right",
            greaterThanOrEqual: "Left is greater than or equal to right",
            lessThan: "Left is less than right",
            lessThanOrEqual: "Left is less than or equal to right",
            equalTo: "Left equals right",
            notEqualTo: "Left does not equal right",
          },
          resultLabel: "Result (Boolean)",
          relationLabel: "Relation (String)",
        },
        branch: {
          title: "Branch paths",
          conditionLabel: "Condition source",
          connected: "From connection",
          required: "Condition required",
          pathTrue: "True (true)",
          pathFalse: "False (false)",
        },
      },
    },
    palette: {
      category: {
        common: "Common",
        flow: "Flow",
        logic: "Logic",
        values: "Values",
        text: "Text",
        vision: "Vision",
        device: "Device",
        timing: "Timing",
        diagnostics: "Diagnostics",
        templates: "Workflow templates",
      },
      capability: {
        unknown:
          "Needs backend capability: {{capabilities}}. No runtime is connected yet, so availability cannot be confirmed.",
        unavailable: "The active backend does not provide: {{capabilities}}.",
      },
      templateBadge: "Template",
      templateHelp:
        "Inserts a group of ordinary editable nodes as a single undo step.",
      insertionHint:
        "Drag to a position on canvas, or click to insert at the center of view.",
      noResultsTitle: "No matching node",
      noResultsDescription:
        "Try another Chinese or English term, or search by the node type key.",
      noProjectNotice:
        "No project is open. Create or open one to start dragging nodes in.",
      projectRequired: "Create or open a project before adding nodes.",
      insertionFailed:
        "The node could not be added. Check the active graph and run state.",
    },
    contextMenu: {
      label: "Canvas actions",
      create: "Add node",
      duplicate: "Duplicate",
      paste: "Paste",
      remove: "Delete selection",
      resolveOverlaps: "Resolve overlapping nodes",
    },
    quickAdd: {
      title: "Quick add",
      description:
        "Type a Chinese or English name and press Enter to insert the node in the middle of the view.",
      connectTitle: "Connect to a new node",
      connectDescription:
        "Compatible nodes are shown by default. Turn off context match to browse every node.",
      contextMatch: "Context match",
      contextMatchEnabledDescription:
        "Show only nodes that can connect to the current port.",
      contextMatchDisabledDescription:
        "Show all nodes; incompatible nodes are inserted without an automatic connection.",
      resultsLabel: "Candidate nodes",
      noCompatibleResults: "No node can accept this connection.",
      repeatAction: "Repeat execution",
      repeatActionTarget: "Return along the existing wire to: {{target}}",
      repeatActionNoCandidate:
        "There is no visible recognition node to return to",
    },
    repeatHint: {
      title: "Repeat",
      description:
        "Return along the existing wire and execute recognition again",
      remove: "Remove repeat hint",
    },
    diagnostics: {
      graphDuplicateGraphId: "Duplicate graph identifier",
      graphDuplicateNodeId: "Duplicate node identifier",
      graphDuplicateEdgeId: "Duplicate connection identifier",
      graphEntryGraphMissing:
        "The project points at an entry graph that does not exist",
      graphEntryKindInvalid: "The project's entry graph must be an entry graph",
      graphNonEntryKindInvalid:
        "Every non-entry graph must be a function graph",
      graphEntryNodeMissing: "The graph has no start node",
      graphMultipleEntryNodes: "The graph has more than one start node",
      graphPureDataCycle: "Pure nodes depend on each other in a cycle",
      graphMultipleParallelOnPath:
        "An execution path cannot pass through a parallel node twice",
      graphDuplicateVariableId: "Duplicate variable identifier",
      graphDuplicateVariableName: "Variable names collide after normalization",
      graphVariablePersistenceUnsupported:
        "Image variables cannot be persisted across tasks",
      functionDuplicateParameterId:
        "Function parameter identifiers must be unique",
      functionDuplicatePortId: "Function port identifiers must be unique",
      functionDuplicateParameterName:
        "Function parameter names must be unique within inputs or outputs",
      functionParallelForbidden:
        "Function graphs cannot contain simultaneous-execution nodes",
      functionParameterPortReserved:
        "Function parameter port identifiers cannot be run or next",
      functionEntryNodeMissing: "The function graph has no input node",
      functionMultipleEntryNodes:
        "The function graph has more than one input node",
      functionReturnNodeMissing: "The function graph has no return node",
      functionNodeOutsideFunction:
        "Function input and return nodes can only appear in function graphs",
      functionCallTargetMissing:
        "The function call does not name an existing function graph",
      functionCallTargetNotFunction:
        "The function call target is not a function graph",
      functionRecursionForbidden:
        "Function graphs cannot call themselves directly or indirectly",
      functionCallDepthExceeded:
        "Function call depth cannot exceed 16 function frames",
      functionPersistentVariableForbidden:
        "Function-local variables cannot be kept across task runs",
      documentDuplicateAssetId: "Duplicate asset identifier",
      documentDuplicateAssetName: "Asset names collide after normalization",
      nodeTypeUnknown: "The runtime does not provide this node type",
      nodeTypeVersionUnsupported:
        "The node was saved by a newer definition than this runtime understands",
      nodeTypeDeprecated: "This node type is deprecated",
      nodeVariableUnknown: "A variable node references an unknown variable",
      nodeVariableTypeMismatch:
        "The variable node type does not match the variable definition",
      nodeCapabilityUnavailable:
        "The active backend does not provide a capability this node needs",
      nodeInputValueUnknownPort:
        "An inline value targets a port the definition does not declare",
      nodeInputValueNotAccepted: "This port does not accept an inline value",
      nodeRequiredInputMissing:
        "A required input has neither a connection nor an inline value",
      edgeSelfConnection: "Both ends of the connection are the same node",
      edgeSourceNodeMissing: "The connection's source node does not exist",
      edgeTargetNodeMissing: "The connection's target node does not exist",
      edgeSourcePortMissing: "The connection's source port does not exist",
      edgeTargetPortMissing: "The connection's target port does not exist",
      edgeDirectionInvalid:
        "Invalid connection direction; a connection runs from an output to an input",
      edgeKindMismatch: "The connection kind does not match the port kind",
      edgeTypeIncompatible:
        "The port types are not compatible: {{sourceType}} cannot feed {{targetType}}",
      edgeCardinalityExceeded: "This port exceeds its connection limit",
    },
    problems: {
      title: "Graph diagnostics",
      none: "No problems found in this project.",
      summary: "Errors {{errors}} · Warnings {{warnings}}",
      blocksRun: "Errors remain and must be fixed before the graph can run.",
      registryUnavailable:
        "The node registry has not loaded, so the graph cannot be validated yet.",
      focus: "Go to the affected element",
      subject: {
        document: "Project",
        asset: "Asset",
        missingGraph: "Unknown graph",
        missingNode: "Unknown node",
        missingEdge: "Unknown connection",
      },
    },
  },
  node: {
    core: {
      flow: {
        start: {
          title: "Start",
          description: "The graph's execution entry point.",
          port: { next: "Next" },
        },
        stop: {
          title: "End path",
          description: "Completes the current execution path intentionally.",
          port: { run: "Run" },
        },
        endPath: {
          title: "End path",
          description:
            "Ends the current execution path. Ending one path lets concurrently running siblings continue; ending all paths stops every branch at a safe node boundary.",
          port: { run: "Run" },
          property: {
            scope: {
              label: "End scope",
              description:
                "Choose whether to end this branch or all branches at a safe node boundary.",
              option: {
                current: "End one path",
                all: "End all paths",
              },
            },
          },
        },
        sequence: {
          title: "Sequence",
          description:
            "Runs the branches connected to the steps port one after another.",
          port: {
            run: "Run",
            order: "Execution order",
            steps: "Legacy steps",
            step1: "Step 1",
            step2: "Step 2",
            step3: "Step 3",
            step4: "Step 4",
            step5: "Step 5",
            step6: "Step 6",
            step7: "Step 7",
            step8: "Step 8",
            step9: "Step 9",
            step10: "Step 10",
            step11: "Step 11",
            step12: "Step 12",
            step13: "Step 13",
            step14: "Step 14",
            step15: "Step 15",
            step16: "Step 16",
          },
        },
        sequenceOrder: {
          title: "Execution Order",
          description: "Outputs an authored order for sequence steps.",
          port: {
            order: "Order",
          },
        },
        boundedRetry: {
          title: "Bounded retry",
          description:
            "Runs the attempt branch at a minimum polling interval, then uses Exhausted after the timeout or attempt limit.",
          port: {
            run: "Run",
            attempt: "Attempt",
            exhausted: "Exhausted",
            attemptNumber: "Attempt number",
            elapsedMilliseconds: "Elapsed (ms)",
          },
          property: {
            timeoutMilliseconds: {
              label: "Timeout (ms)",
              description:
                "Maximum retry duration measured from first activation.",
            },
            rateLimitMilliseconds: {
              label: "Polling interval (ms)",
              description:
                "Minimum interval between the start of consecutive rounds.",
            },
            maximumAttempts: {
              label: "Maximum attempts",
              description:
                "Prevents another attempt from starting after this count, even before timeout.",
            },
          },
        },
        runCounter: {
          title: "Run counter",
          description:
            "Counts visits during the current run and branches at the target count.",
          port: {
            run: "Run",
            targetCount: "Target count",
            currentCount: "Current count",
            reached: "Reached",
            notReached: "Not reached",
          },
        },
        parallel: {
          title: "Run concurrently",
          description:
            "Starts two or three direct steps concurrently. Operations on the same device remain serialized for safety.",
          port: {
            run: "Run",
            branch1: "Concurrent step 1",
            branch2: "Concurrent step 2",
            branch3: "Concurrent step 3",
          },
        },
      },
      function: {
        input: {
          title: "Function Input",
          description: "Provides the values passed into the current function.",
        },
        return: {
          title: "Function Output",
          description: "Returns the selected values from the current function.",
        },
        call: {
          title: "Function Call",
          description:
            "Invokes another function graph and returns its outputs.",
        },
      },
      value: {
        numberLiteral: {
          title: "Number",
          description: "Outputs a fixed numeric value.",
          port: { value: "Value" },
          property: {
            value: {
              label: "Value",
              description: "The fixed number this node always outputs.",
            },
          },
        },
        stringLiteral: {
          title: "Text",
          description: "Outputs a fixed text value.",
          port: { value: "Value" },
          property: {
            value: {
              label: "Value",
              description: "The fixed text this node always outputs.",
            },
          },
        },
      },
      variable: {
        keyword: {
          variable: "Variable",
          get: "Get",
          set: "Set",
        },
        getBool: {
          title: "Get boolean variable",
          description: "Reads a boolean variable from the current graph.",
          port: { value: "Variable value" },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the boolean variable to read.",
            },
          },
        },
        setBool: {
          title: "Set boolean variable",
          description: "Writes the input boolean into a graph variable.",
          port: {
            run: "Run",
            value: "Variable value",
            storedValue: "Variable value",
            next: "Next",
          },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the boolean variable to write.",
            },
          },
        },
        getNumber: {
          title: "Get number variable",
          description: "Reads a number variable from the current graph.",
          port: { value: "Variable value" },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the number variable to read.",
            },
          },
        },
        setNumber: {
          title: "Set number variable",
          description: "Writes the input number into a graph variable.",
          port: {
            run: "Run",
            value: "Variable value",
            storedValue: "Variable value",
            next: "Next",
          },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the number variable to write.",
            },
          },
        },
        getString: {
          title: "Get text variable",
          description: "Reads a text variable from the current graph.",
          port: { value: "Variable value" },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the text variable to read.",
            },
          },
        },
        setString: {
          title: "Set text variable",
          description: "Writes the input text into a graph variable.",
          port: {
            run: "Run",
            value: "Variable value",
            storedValue: "Variable value",
            next: "Next",
          },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the text variable to write.",
            },
          },
        },
        getPoint: {
          title: "Get point variable",
          description: "Reads a point variable from the current graph.",
          port: { value: "Variable value" },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the point variable to read.",
            },
          },
        },
        setPoint: {
          title: "Set point variable",
          description: "Writes the input point into a graph variable.",
          port: {
            run: "Run",
            value: "Variable value",
            storedValue: "Variable value",
            next: "Next",
          },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the point variable to write.",
            },
          },
        },
        getRect: {
          title: "Get region variable",
          description: "Reads a region variable from the current graph.",
          port: { value: "Variable value" },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the region variable to read.",
            },
          },
        },
        setRect: {
          title: "Set region variable",
          description: "Writes the input region into a graph variable.",
          port: {
            run: "Run",
            value: "Variable value",
            storedValue: "Variable value",
            next: "Next",
          },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the region variable to write.",
            },
          },
        },
        getImageRef: {
          title: "Get image variable",
          description: "Reads an image variable from the current graph.",
          port: { value: "Variable value" },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the image variable to read.",
            },
          },
        },
        setImageRef: {
          title: "Set image variable",
          description: "Writes the input image into a graph variable.",
          port: {
            run: "Run",
            value: "Variable value",
            storedValue: "Variable value",
            next: "Next",
          },
          property: {
            variableId: {
              label: "Variable identifier",
              description: "Select the image variable to write.",
            },
          },
        },
      },
      image: {
        projectAsset: {
          title: "Project image",
          description:
            "Outputs an image from the current project's captured assets.",
          port: { image: "Image" },
          property: {
            assetId: {
              label: "Image asset",
              description:
                "References a project capture by stable asset ID, so renaming does not break it.",
            },
          },
        },
      },
      geometry: {
        point: {
          title: "Point",
          description:
            "Binds a fixed coordinate at its reference resolution to the current captured frame.",
          port: {
            image: "Reference image",
            x: "X coordinate",
            y: "Y coordinate",
            referenceWidth: "Reference width",
            referenceHeight: "Reference height",
            point: "Point",
          },
        },
        rectangle: {
          title: "Rectangle",
          description:
            "Binds a fixed rectangle at its reference resolution to the current captured frame.",
          port: {
            image: "Reference image",
            x: "X coordinate",
            y: "Y coordinate",
            width: "Width",
            height: "Height",
            referenceWidth: "Reference width",
            referenceHeight: "Reference height",
            rectangle: "Rectangle",
          },
        },
      },
      collection: {
        imageList: {
          title: "Multiple recognition images",
          description:
            "Combines images in order for recognition to try one by one.",
          port: {
            item1: "Image 1",
            item2: "Image 2",
            item3: "Image 3",
            item4: "Image 4",
            item5: "Image 5",
            item6: "Image 6",
            item7: "Image 7",
            item8: "Image 8",
            item9: "Image 9",
            item10: "Image 10",
            item11: "Image 11",
            item12: "Image 12",
            item13: "Image 13",
            item14: "Image 14",
            item15: "Image 15",
            item16: "Image 16",
            images: "Images",
          },
        },
        regionList: {
          title: "Multiple recognition regions",
          description:
            "Combines regions in order for recognition to try one by one.",
          port: {
            item1: "Region 1",
            item2: "Region 2",
            item3: "Region 3",
            item4: "Region 4",
            item5: "Region 5",
            item6: "Region 6",
            item7: "Region 7",
            item8: "Region 8",
            item9: "Region 9",
            item10: "Region 10",
            item11: "Region 11",
            item12: "Region 12",
            item13: "Region 13",
            item14: "Region 14",
            item15: "Region 15",
            item16: "Region 16",
            regions: "Regions",
          },
        },
        pointList: {
          title: "Multiple click points",
          description:
            "Combines click points in order for random selection or sequential clicking.",
          port: {
            item1: "Point 1",
            item2: "Point 2",
            item3: "Point 3",
            item4: "Point 4",
            item5: "Point 5",
            item6: "Point 6",
            item7: "Point 7",
            item8: "Point 8",
            item9: "Point 9",
            item10: "Point 10",
            item11: "Point 11",
            item12: "Point 12",
            item13: "Point 13",
            item14: "Point 14",
            item15: "Point 15",
            item16: "Point 16",
            points: "Click point list",
          },
        },
      },
      logic: {
        numberCompare: {
          title: "Compare numbers",
          description: "Compares two numbers and outputs a boolean result.",
          keyword: { compare: "greater less equal compare" },
          port: {
            left: "Left",
            right: "Right",
            result: "Result",
            relation: "Relation",
          },
          property: {
            operator: {
              label: "Comparison",
              description:
                "How the left and right values are compared. The result is a boolean.",
              option: {
                greaterThan: "Left is greater than right",
                greaterThanOrEqual: "Left is greater than or equal to right",
                lessThan: "Left is less than right",
                lessThanOrEqual: "Left is less than or equal to right",
                equalTo: "Left equals right",
                notEqualTo: "Left does not equal right",
              },
              optionDescription: {
                greaterThan:
                  "True only when the left value is greater than the right.",
                greaterThanOrEqual:
                  "True when the left value is greater than or equal to the right.",
                lessThan:
                  "True only when the left value is less than the right.",
                lessThanOrEqual:
                  "True when the left value is less than or equal to the right.",
                equalTo: "True when the two numbers are equal.",
                notEqualTo: "True when the two numbers are different.",
              },
            },
          },
        },
        numberSelect: {
          title: "Select number",
          description:
            "Selects the maximum or minimum input; ties use the first input.",
          port: {
            a: "A",
            b: "B",
            c: "C",
            d: "D",
            e: "E",
            f: "F",
            g: "G",
            h: "H",
            i: "I",
            j: "J",
            k: "K",
            l: "L",
            m: "M",
            n: "N",
            o: "O",
            p: "P",
            value: "Output value",
            condition: "Output condition",
          },
          property: {
            mode: {
              label: "Selection",
              description: "Outputs the maximum or minimum authored input.",
              option: { maximum: "Maximum", minimum: "Minimum" },
            },
          },
        },
        branch: {
          title: "Judgment Branch",
          description: "Chooses the next branch from a boolean condition.",
          port: {
            run: "Run",
            condition: "Condition",
            whenTrue: "When true",
            whenFalse: "When false",
          },
        },
        taskChoice: {
          title: "Task choice",
          description:
            "Selects one executable branch from the current task setting; an unknown case continues through Unmatched.",
          port: {
            run: "Run",
            selectedCaseId: "Case ID",
            case: "Case",
            unmatched: "Unmatched",
          },
          property: {
            selectedCaseId: {
              label: "Selected case",
              description: "The stable case identifier to execute.",
            },
            settingKey: {
              label: "Setting key",
              description:
                "The stable internal identity used by top task settings.",
            },
            exposeInTaskSettings: {
              label: "Show in task settings",
              description:
                "When enabled, this choice appears in the current task's top bar.",
            },
          },
        },
        caseOverlayBool: {
          title: "Boolean case overlay",
          description:
            "Uses the selected case value when present, otherwise the fallback value.",
          port: {
            selectedCaseId: "Case ID",
            fallback: "Fallback",
            case: "Case",
            value: "Value",
          },
        },
        caseOverlayNumber: {
          title: "Number case overlay",
          description:
            "Uses the selected case number when present, otherwise the fallback number.",
          port: {
            selectedCaseId: "Case ID",
            fallback: "Fallback",
            case: "Case",
            value: "Value",
          },
        },
        caseOverlayImageRef: {
          title: "Image case overlay",
          description:
            "Uses the selected case image when present, otherwise the fallback image.",
          port: {
            selectedCaseId: "Case ID",
            fallback: "Fallback image",
            case: "Case image",
            value: "Image",
          },
        },
      },
      math: {
        expression: {
          title: "Calculate value",
          description:
            "Calculates a finite number from A, B, C, and additional inputs using arithmetic and parentheses.",
          port: {
            a: "A",
            b: "B",
            c: "C",
            d: "D",
            e: "E",
            f: "F",
            g: "G",
            h: "H",
            i: "I",
            j: "J",
            k: "K",
            l: "L",
            m: "M",
            n: "N",
            o: "O",
            p: "P",
            result: "Output value",
          },
          property: {
            expression: {
              label: "Expression",
              description:
                "Only A through P, finite numbers, +-*/, and parentheses are allowed.",
            },
          },
        },
        arithmetic: {
          title: "Arithmetic",
          description:
            "Adds, subtracts, multiplies, or divides two finite numbers.",
          port: { left: "Left", right: "Right", result: "Result" },
          property: {
            operator: {
              label: "Operator",
              description: "Selects the operation between Left and Right.",
              option: {
                add: "Add (+)",
                subtract: "Subtract (−)",
                multiply: "Multiply (×)",
                divide: "Divide (÷)",
              },
              optionDescription: {
                add: "Calculate left plus right.",
                subtract: "Calculate left minus right.",
                multiply: "Calculate left times right.",
                divide:
                  "Calculate left divided by right; right cannot be zero.",
              },
            },
          },
        },
      },
      time: {
        delay: {
          title: "Delay",
          description: "Waits for a bounded duration before continuing.",
          port: {
            run: "Run",
            durationMilliseconds: "Duration (ms)",
            next: "Next",
          },
        },
      },
      diagnostic: {
        log: {
          title: "Write log",
          description: "Adds a bounded message to the current run log.",
          port: {
            run: "Run",
            message: "Message",
            textPart: "Text segment",
            numberPart: "Number segment",
            next: "Next",
          },
          property: {
            segmentKinds: {
              label: "Segment types",
              description: "Joins text and number segments in order.",
            },
            appendNewline: {
              label: "Append newline",
              description: "Adds a newline to the end of this log entry.",
            },
          },
        },
      },
    },
    automation: {
      captureScreen: {
        title: "Capture screen",
        description: "Captures one frame from the connected device.",
        port: {
          run: "Run",
          image: "Image",
          width: "Width",
          height: "Height",
          next: "Next",
        },
      },
      clickRectCenter: {
        title: "Click rectangle center",
        description:
          "Adjusts a recognized rectangle, then clicks the center of the result.",
        port: {
          run: "Run",
          rect: "Rectangle",
          offsetX: "Horizontal offset",
          offsetY: "Vertical offset",
          offsetWidth: "Width adjustment",
          offsetHeight: "Height adjustment",
          clicked: "Clicked",
          next: "Next",
          failed: "Known failure",
        },
        property: {
          offsetX: {
            label: "Horizontal offset",
            description:
              "Adds this pixel value to the rectangle's X coordinate.",
          },
          offsetY: {
            label: "Vertical offset",
            description:
              "Adds this pixel value to the rectangle's Y coordinate.",
          },
          offsetWidth: {
            label: "Width adjustment",
            description: "Adds this pixel value to the rectangle's width.",
          },
          offsetHeight: {
            label: "Height adjustment",
            description: "Adds this pixel value to the rectangle's height.",
          },
        },
      },
      clickPoint: {
        title: "Click",
        description:
          "Clicks one point, multiple points, or a point inside a rectangle.",
        port: {
          run: "Run",
          point: "Point",
          image: "Reference image",
          points: "Multiple points",
          rect: "Click rectangle",
          x: "X coordinate",
          y: "Y coordinate",
          referenceWidth: "Reference width",
          referenceHeight: "Reference height",
          clicked: "Clicked",
          clickedCount: "Clicked count",
          selectedIndex: "Selected index",
          next: "Next",
          failed: "Known failure",
        },
        property: {
          inputMode: {
            label: "Coordinate source",
            description:
              "Choose single-point, multiple-point, or rectangle clicking.",
            option: {
              point: "Single point",
              coordinates: "Direct coordinates",
              randomPoints: "Random point",
              sequentialPoints: "Click all in order",
              rectCenter: "Rectangle center",
              rectRandom: "Random point in rectangle",
            },
            optionDescription: {
              point: "Receive one coordinate point from another node.",
              coordinates:
                "Enter coordinates directly or pick them from the emulator.",
              randomPoints:
                "Choose one point at random from the connected list.",
              sequentialPoints: "Click every connected point in order.",
              rectCenter: "Click the center of the connected rectangle.",
              rectRandom:
                "Choose a random pixel inside the connected rectangle.",
            },
          },
          intervalMilliseconds: {
            label: "Click interval (ms)",
            description:
              "Wait time between clicks when clicking multiple points in order.",
          },
        },
      },
      launchAndroidApp: {
        title: "Launch Android app",
        description:
          "Starts one explicitly named application component on the device.",
        port: {
          run: "Run",
          launched: "Launched",
          next: "Next",
        },
        property: {
          intent: {
            label: "Application identifier",
            description:
              "Enter a package name or package/Activity; extras and commands are not supported.",
          },
        },
      },
      pressAndroidKey: {
        title: "Press Android key",
        description: "Sends one supported semantic key to the current device.",
        port: {
          run: "Run",
          pressed: "Pressed",
          next: "Next",
        },
        property: {
          key: {
            label: "Key",
            description:
              "This version supports Escape for dismissing an in-app overlay.",
            option: { escape: "Escape" },
            optionDescription: { escape: "Sends the Android Escape key." },
          },
        },
      },
      swipe: {
        title: "Swipe",
        description:
          "Performs one explicit single-contact swipe on the device.",
        port: {
          run: "Run",
          start: "Start",
          end: "End",
          completed: "Completed",
          next: "Next",
          failed: "Known failure",
        },
        property: {
          durationMilliseconds: {
            label: "Swipe duration (ms)",
            description:
              "How long movement from start to end takes, from 1 to 60000 milliseconds.",
          },
        },
      },
      touchAction: {
        title: "Touch action",
        description:
          "Performs a click, long press, swipe, or two-finger swipe on the current device frame.",
        port: {
          run: "Run",
          start: "Start / click point",
          end: "End",
          secondaryStart: "Second start",
          secondaryEnd: "Second end",
          completed: "Completed",
          next: "Next",
        },
        property: {
          actionType: {
            label: "Action type",
            description: "Selects the touch action sent to the device.",
            option: {
              click: "Click",
              longPress: "Long press",
              swipe: "Swipe",
              multiSwipe: "Multi-finger swipe (two fingers)",
            },
            optionDescription: {
              click: "Perform one click at a coordinate point.",
              longPress:
                "Keep the contact pressed for the configured duration.",
              swipe: "Move from the start point to the end point.",
              multiSwipe: "Move two contacts at the same time.",
            },
          },
          longPressDurationMilliseconds: {
            label: "Long-press duration (ms)",
            description:
              "How long the contact remains pressed, from 1 to 60000 milliseconds.",
          },
          swipeDurationMilliseconds: {
            label: "Swipe duration (ms)",
            description:
              "How long movement from start to end takes, from 1 to 60000 milliseconds.",
          },
          secondaryStartDelayMilliseconds: {
            label: "Second-contact delay (ms)",
            description:
              "How much later the second contact starts during a two-finger swipe.",
          },
        },
        hint: {
          click: "Connect Start to perform a click.",
          longPress: "Connect Start and set the long-press duration.",
          swipe: "Connect Start and End, then set the swipe duration.",
          multiSwipe:
            "Connect both start/end pairs. This version supports two contacts.",
        },
      },
    },
    vision: {
      ocr: {
        title: "Recognize text",
        description: "Recognizes text in an image or a region of one.",
        port: {
          run: "Run",
          image: "Image",
          roi: "Recognition region",
          regions: "Multiple recognition regions",
          confidenceThreshold: "Minimum confidence",
          result: "Recognition result",
          matched: "Recognized",
          bestText: "Best text",
          bestConfidence: "Output value",
          matchedRegionIndex: "Matched region index",
          bestRect: "Best region",
          next: "Next",
        },
        property: {
          confidenceThreshold: {
            label: "Minimum confidence",
            description:
              "Keeps only text candidates at or above this confidence.",
          },
          expected: {
            label: "Expected text patterns",
            description:
              "Prioritizes candidates matching these regular-expression patterns in order; an empty list keeps the default ranking.",
          },
        },
      },
      templateMatch: {
        title: "Template match",
        description:
          "Finds regions in an image that resemble a template image.",
        port: {
          run: "Run",
          image: "Target image",
          template: "Template image",
          templates: "Multiple recognition images",
          roi: "Recognition region",
          regions: "Multiple recognition regions",
          threshold: "Minimum similarity",
          matched: "Matched",
          bestRect: "Best rectangle",
          bestScore: "Best score",
          matchedRegionIndex: "Matched region index",
          matchedTemplate: "Matched image",
          matchedTemplateIndex: "Matched image index",
          rects: "Match rectangles",
          scores: "Match scores",
          next: "Next",
        },
        property: {
          threshold: {
            label: "Minimum similarity",
            description: "Keeps template matches that reach this similarity.",
          },
          method: {
            label: "Match method",
            description: "Selects how template pixels are compared.",
            option: {
              normalizedCoefficient: "Normalized coefficient",
              coefficient: "Coefficient",
              rgbDifference: "RGB difference",
            },
            optionDescription: {
              normalizedCoefficient:
                "A normalized correlation comparison that is more tolerant of brightness changes.",
              coefficient:
                "Compares the direct correlation between the template and target.",
              rgbDifference:
                "Compares pixels by their RGB channel differences.",
            },
          },
          greenMask: {
            label: "Green mask",
            description:
              "Treats pure green template pixels as a transparent mask.",
          },
        },
      },
      featureMatch: {
        title: "Feature match",
        description:
          "Finds a scaled or rotated target using local image features.",
        port: {
          run: "Run",
          image: "Target image",
          template: "Template image",
          templates: "Multiple recognition images",
          roi: "Recognition region",
          regions: "Multiple recognition regions",
          matched: "Matched",
          bestRect: "Best rectangle",
          bestCount: "Best feature count",
          matchedRegionIndex: "Matched region index",
          matchedTemplate: "Matched image",
          matchedTemplateIndex: "Matched image index",
          rects: "Match rectangles",
          counts: "Feature counts",
          next: "Next",
        },
        property: {
          detector: {
            label: "Feature detector",
            description:
              "Selects the algorithm used to extract and compare local features.",
            option: {
              SIFT: "SIFT",
              KAZE: "KAZE",
              AKAZE: "AKAZE",
              BRISK: "BRISK",
              ORB: "ORB",
            },
            optionDescription: {
              SIFT: "High accuracy for targets that need stable features.",
              KAZE: "Extracts features in a nonlinear scale space.",
              AKAZE: "Balances feature stability and speed.",
              BRISK: "A fast choice for resource-constrained scenes.",
              ORB: "Fast features suitable for general real-time matching.",
            },
          },
          minimumCount: {
            label: "Minimum features",
            description:
              "Requires at least this many reliable feature correspondences.",
          },
          ratio: {
            label: "Distance ratio",
            description:
              "A lower value rejects ambiguous features more strictly.",
          },
          greenMask: {
            label: "Green mask",
            description:
              "Treats pure green template pixels as a transparent mask.",
          },
        },
      },
      colorMatch: {
        title: "Color match",
        description: "Finds pixel regions within a configured color range.",
        port: {
          run: "Run",
          image: "Target image",
          roi: "Recognition region",
          regions: "Multiple recognition regions",
          matched: "Matched",
          bestRect: "Best rectangle",
          bestCount: "Best pixel count",
          matchedRegionIndex: "Matched region index",
          rects: "Match rectangles",
          counts: "Pixel counts",
          next: "Next",
        },
        property: {
          method: {
            label: "Color space",
            description:
              "Selects the channel type. Grayscale uses only channel one.",
            option: { RGB: "RGB", HSV: "HSV", GRAY: "Grayscale" },
            optionDescription: {
              RGB: "Use red, green, and blue channels directly.",
              HSV: "Filter by hue, saturation, and value.",
              GRAY: "Use only the grayscale channel.",
            },
          },
          lower1: {
            label: "Lower channel 1",
            description: "Minimum value for channel one.",
          },
          lower2: {
            label: "Lower channel 2",
            description: "Minimum value for channel two.",
          },
          lower3: {
            label: "Lower channel 3",
            description: "Minimum value for channel three.",
          },
          upper1: {
            label: "Upper channel 1",
            description: "Maximum value for channel one.",
          },
          upper2: {
            label: "Upper channel 2",
            description: "Maximum value for channel two.",
          },
          upper3: {
            label: "Upper channel 3",
            description: "Maximum value for channel three.",
          },
          minimumCount: {
            label: "Minimum pixels",
            description:
              "Requires at least this many pixels inside the color range.",
          },
          connected: {
            label: "Merge connected regions",
            description:
              "Combines adjacent matching pixels into connected regions.",
          },
        },
      },
    },
    text: {
      parseNumber: {
        title: "Parse number",
        description:
          "Parses text as a finite number using explicit separator rules.",
        port: {
          run: "Run",
          text: "Text",
          number: "Number",
          normalizedText: "Normalized text",
          parsed: "Parsed",
          invalid: "Invalid",
        },
        property: {
          decimalSeparator: {
            label: "Decimal separator",
            description: "The explicit separator used before decimal digits.",
          },
          groupingSeparator: {
            label: "Grouping separator",
            description: "The explicit thousands-group separator, or none.",
          },
          normalizeFullWidth: {
            label: "Normalize full-width digits",
            description:
              "Converts full-width digits and separators before parsing.",
          },
          allowSign: {
            label: "Allow sign",
            description: "Accepts an optional leading plus or minus sign.",
          },
          minimum: {
            label: "Minimum",
            description:
              "Rejects parsed values lower than this optional bound.",
          },
          maximum: {
            label: "Maximum",
            description:
              "Rejects parsed values higher than this optional bound.",
          },
        },
      },
      readText: {
        title: "Read text",
        description:
          "Reads a numbered OCR candidate using a spatial reading order.",
        port: {
          run: "Run",
          result: "OCR result",
          text: "Text",
          rect: "Text region",
          selected: "Selected",
          missing: "Index missing",
        },
        property: {
          candidateIndex: {
            label: "Candidate number",
            description: "Selects the OCR candidate to output, starting at 1.",
          },
          readingOrder: {
            label: "Reading order",
            description:
              "Orders a matrix by the selected primary direction, then advances in the other direction.",
            option: {
              rowMajor: "Left to right, then top to bottom",
              columnMajor: "Top to bottom, then left to right",
            },
            optionDescription: {
              rowMajor:
                "Read each row from left to right before moving to the next row.",
              columnMajor:
                "Read each column from top to bottom before moving to the next column.",
            },
          },
        },
      },
      readNumber: {
        title: "Read number",
        description:
          "Reads a numbered OCR candidate and parses it as a finite number using an explicit format.",
        port: {
          run: "Run",
          result: "OCR result",
          number: "Number",
          normalizedText: "Normalized text",
          rect: "Text region",
          selected: "Selected",
          missing: "Index missing",
          invalid: "Invalid number",
        },
        property: {
          candidateIndex: {
            label: "Candidate number",
            description: "Selects the OCR candidate to parse, starting at 1.",
          },
          readingOrder: {
            label: "Reading order",
            description:
              "Orders a matrix by the selected primary direction, then advances in the other direction.",
            option: {
              rowMajor: "Left to right, then top to bottom",
              columnMajor: "Top to bottom, then left to right",
            },
            optionDescription: {
              rowMajor:
                "Read each row from left to right before moving to the next row.",
              columnMajor:
                "Read each column from top to bottom before moving to the next column.",
            },
          },
          decimalSeparator: {
            label: "Decimal separator",
            description: "The explicit separator before decimal digits.",
            option: { ".": "Dot (.)", ",": "Comma (,)" },
            optionDescription: {
              ".": "Use a dot before the decimal digits.",
              ",": "Use a comma before the decimal digits.",
            },
          },
          groupingSeparator: {
            label: "Grouping separator",
            description: "The explicit thousands separator, or none.",
            option: {
              "": "None",
              ".": "Dot (.)",
              ",": "Comma (,)",
              " ": "Space",
            },
            optionDescription: {
              "": "Do not use a grouping separator.",
              ".": "Group thousands with a dot.",
              ",": "Group thousands with a comma.",
              " ": "Group thousands with a space.",
            },
          },
          normalizeFullWidth: {
            label: "Normalize full-width digits",
            description:
              "Converts full-width digits and separators before parsing.",
          },
          allowSign: {
            label: "Allow sign",
            description: "Accepts an optional leading plus or minus sign.",
          },
          minimum: { label: "Minimum", description: "Optional lower bound." },
          maximum: { label: "Maximum", description: "Optional upper bound." },
        },
      },
      readValue: {
        title: "Read value",
        description:
          "Reads text or numbers from OCR results and outputs them by position or reading order.",
        port: {
          run: "Run",
          result: "OCR result",
          text: "Text",
          texts: "Text list",
          number: "Number",
          numbers: "Number list",
          rect: "Region",
          rects: "Region list",
          selected: "Read",
          missing: "Not found",
          invalid: "Invalid",
        },
        property: {
          valueMode: {
            label: "Read content",
            description: "Choose whether to output text or parse a number.",
            option: { text: "Text", number: "Number" },
            optionDescription: {
              text: "Outputs the recognized text directly.",
              number: "Parses the recognized content as a finite number.",
            },
          },
          numberType: {
            label: "Number type",
            description: "Choose the type constraint for numeric parsing.",
            option: {
              integer: "Integer",
              float: "Float",
              percentage: "Percentage",
              positive: "Positive",
              unsignedInteger: "Unsigned integer",
            },
            optionDescription: {
              integer: "A finite integer that may include a sign.",
              float: "Any finite number.",
              percentage:
                "Requires a percent sign and outputs the value divided by 100.",
              positive: "A number greater than zero.",
              unsignedInteger: "An integer greater than or equal to zero.",
            },
          },
          selectionMode: {
            label: "Output position",
            description: "Choose all candidates or a specific row and item.",
            option: { all: "All", position: "Specific position" },
            optionDescription: {
              all: "Outputs every valid candidate in reading order.",
              position:
                "Outputs only the candidate at the selected row and item.",
            },
          },
          readingOrder: {
            label: "Reading order",
            description:
              "Choose whether results are grouped by rows or columns.",
            option: { rowMajor: "By row", columnMajor: "By column" },
            optionDescription: {
              rowMajor: "Reads left to right, then moves to the next row.",
              columnMajor:
                "Reads top to bottom, then moves to the next column.",
            },
          },
          lineIndex: {
            label: "Row number",
            description: "Selects the row to read, starting at 1.",
          },
          itemIndex: {
            label: "Item number",
            description:
              "Selects the candidate within the row or column, starting at 1.",
          },
          decimalSeparator: {
            label: "Decimal separator",
            description: "The explicit separator used before decimal digits.",
            option: { ".": "Dot (.)", ",": "Comma (,)" },
            optionDescription: {
              ".": "Use a dot before the decimal digits.",
              ",": "Use a comma before the decimal digits.",
            },
          },
          groupingSeparator: {
            label: "Grouping separator",
            description: "The explicit thousands-group separator, or none.",
            option: {
              "": "None",
              ".": "Dot (.)",
              ",": "Comma (,)",
              " ": "Space",
            },
            optionDescription: {
              "": "Do not use a grouping separator.",
              ".": "Group thousands with a dot.",
              ",": "Group thousands with a comma.",
              " ": "Group thousands with a space.",
            },
          },
          normalizeFullWidth: {
            label: "Normalize full-width digits",
            description:
              "Converts full-width digits and separators before parsing.",
          },
          allowSign: {
            label: "Allow sign",
            description: "Accepts an optional leading plus or minus sign.",
          },
          minimum: { label: "Minimum", description: "Optional lower bound." },
          maximum: { label: "Maximum", description: "Optional upper bound." },
        },
      },
    },
    test: {
      fake: {
        ocr: {
          title: "Fake OCR",
          description: "Returns deterministic text for runtime tests.",
          port: {
            run: "Run",
            fixtureText: "Fixture text",
            matched: "Matched",
            text: "Text",
            next: "Next",
          },
          property: {
            matched: {
              label: "Return a match",
              description:
                "Controls whether the fake recognizer reports a match.",
            },
          },
        },
        action: {
          title: "Fake action",
          description: "Records a deterministic action for runtime tests.",
          port: {
            run: "Run",
            label: "Label",
            recorded: "Recorded",
            next: "Next",
          },
        },
      },
    },
  },
  workflowGroup: {
    imageRecognition: {
      title: "Image recognition template",
      description:
        "Captures the current frame and uses template, feature, or color matching.",
      method: "Match method",
      methodDescription:
        "Choose how the target is found; each method responds differently to templates, colors, and scale changes.",
      methods: {
        template: "Template match",
        feature: "Feature match",
        color: "Color match",
      },
      methodOptionDescription: {
        template:
          "Best for targets with a stable appearance and size; a template image is required.",
        feature:
          "Tolerates some scale or rotation changes but needs enough local features.",
        color:
          "Finds regions by a color range and does not need a template image.",
      },
      templateAsset: "Template image",
      templateAssetDescription:
        "Choose a template capture saved in the project; color matching does not use it.",
      templatePlaceholder: "Choose a project capture",
      templateNotUsed: "Color matching does not use a template image.",
      noTemplateAssets:
        "Capture and save a template from the device preview first.",
      matchThreshold: "Template match threshold",
      matchThresholdDescription:
        "Keep only regions whose match score reaches this value, from 0 to 1; the default is 0.7.",
      region: "Limit recognition region",
      regionDescription:
        "When enabled, matching is limited to the rectangle; otherwise the full frame is used.",
      pickRegion: "Pick from preview",
      regionField: {
        x: "X",
        y: "Y",
        width: "Width",
        height: "Height",
        referenceWidth: "Screen width",
        referenceHeight: "Screen height",
      },
      port: {
        run: "Run",
        template: "Template image",
        templates: "Multiple recognition images",
        roi: "Recognition region",
        regions: "Multiple recognition regions",
        matched: "Matched",
        matchValue: "Output value",
        matchedRegionIndex: "Matched region index",
        matchedTemplateIndex: "Matched image index",
        result: "Recognition result",
        bestText: "Best text",
        bestRect: "Best region",
        image: "Current frame",
        noMatch: "No match",
        next: "Next",
      },
    },
    textRecognition: {
      title: "Text recognition template",
      description:
        "Waits, captures the screen, performs OCR, and optionally clicks after a match.",
      clickMethod: "Click method",
      clickMethodDescription:
        "Choose whether a successful recognition clicks the recognized region center or a fixed point.",
      clickMethods: {
        none: "Do not click",
        rectCenter: "Click recognized region center",
        point: "Click a specified point",
      },
      clickMethodOptionDescription: {
        none: "Only expose the recognition result; do not click the device.",
        rectCenter: "Click the center of the best recognized text region.",
        point: "Click the fixed point saved in this workflow node.",
      },
      beforeDelay: "Delay before recognition (ms)",
      afterDelay: "Delay after click (ms)",
      confidenceThreshold: "Minimum confidence",
      confidenceThresholdDescription:
        "Text candidates below this threshold are ignored.",
      region: "Limit recognition region",
      regionDescription:
        "When enabled, OCR runs only inside the rectangle; otherwise the full frame is used.",
      pickRegion: "Pick from preview",
      clickPoint: "Specified click point",
      clickPointDescription:
        "Set the fixed point to click after successful recognition.",
      pickPoint: "Pick from preview",
      regionField: {
        x: "X",
        y: "Y",
        width: "Width",
        height: "Height",
        referenceWidth: "Screen width",
        referenceHeight: "Screen height",
      },
      pointField: {
        x: "X",
        y: "Y",
        referenceWidth: "Screen width",
        referenceHeight: "Screen height",
      },
      port: {
        run: "Run",
        beforeDelayMilliseconds: "Delay before recognition",
        roi: "Recognition region",
        regions: "Multiple recognition regions",
        afterDelayMilliseconds: "Delay after click",
        clickPoint: "Click point",
        matched: "Text matched",
        matchValue: "Output value",
        matchedRegionIndex: "Matched region index",
        result: "Recognition result",
        bestText: "Best text",
        bestRect: "Best region",
        image: "Current frame",
        noMatch: "No match",
        next: "Next",
      },
    },
    recognition: {
      clickEnabled: "Click after a match",
      clickEnabledDescription:
        "When enabled, reveal the click method and position; otherwise only return recognition results.",
      delayMode: "Delay position",
      delayModeDescription:
        "Choose whether the wait occurs before recognition or after recognition and before clicking.",
      delayBeforeRecognition: "Delay before recognition",
      delayBeforeRecognitionDescription:
        "Wait first, then capture the frame and start recognition.",
      delayBeforeClick: "Delay click after recognition",
      delayBeforeClickDescription:
        "Wait after a successful recognition and before clicking.",
      delayMilliseconds: "Delay (ms)",
      delayMillisecondsDescription:
        "The wait duration, bounded by the runtime node limit.",
    },
    actions: {
      expand: "Expand workflow node",
      collapse: "Collapse workflow node",
      promoteInput: "Extract as connected node",
      revealParameterNode: "Show connected parameter node",
    },
    coordinateDetails: "Coordinate details",
    steps: "Execution steps",
    stepCount: "Execution steps ({{count}})",
  },
  template: {
    recognizeNumberAndBranch: {
      title: "Recognize a number and branch",
      description:
        "Recognizes a number on screen, compares it with a threshold, and branches.",
      port: {
        run: "Run",
        next: "Next",
      },
    },
    compareNumbersAndBranch: {
      title: "Compare numbers and branch",
      description:
        "Inserts separate Start, Compare, and Branch nodes wired as an editable workflow.",
    },
    captureAndClickPoint: {
      title: "Capture and click a point",
      description:
        "Inserts Start, Capture, Point, and Click nodes. Select a coordinate before running it.",
    },
  },
  publishing: {
    action: {
      open: "Export and publish",
    },
    dialog: {
      title: "Export and publish project",
      description:
        "Create a signed .rino-package for the Rino client, or publish it as a GitHub Release asset.",
      publicNotice:
        "Publishing publicly uploads the saved project graphs, metadata, and project assets to GitHub. Recovery data, logs, local paths, credentials, and editor settings are never included.",
      authTitle: "GitHub CLI authorization",
      authDescription:
        "The official GitHub CLI starts the browser/device authorization flow. Rino never reads, stores, or displays a GitHub account identifier or token; credentials are managed by GH CLI.",
      authFlow:
        "Follow the GH CLI prompt to open the official browser authorization page. A one-time code is copied to the clipboard for you to paste when prompted.",
      logoutWarning:
        "This only removes the local GH CLI login configuration; it does not revoke the remote OAuth token. Confirm sign-out?",
      exportTitle: "Export Rino package",
      fileTypeLabel: "Rino package",
    },
    fields: {
      packageId: "Package ID",
      version: "Version",
      summary: "Summary",
      publisherId: "Package namespace (self-declared)",
      publisherName: "Package attribution (self-declared)",
      license: "License identifier",
      githubOwner: "GitHub owner",
      githubRepository: "GitHub repository",
      metadataNotice:
        "Package namespace and attribution are self-declared metadata, not GitHub identity or verification. Repository and upload identity come from the active GH CLI login; owner and repository text only select the target and are permission-checked when publishing.",
    },
    status: {
      checking: "Checking GitHub CLI sign-in…",
      authenticated: "GitHub CLI authenticated",
      loginRequired:
        "GitHub CLI is not signed in. Click sign in and complete the official browser/device flow.",
      cliRequired:
        "GitHub CLI was not found. Local package export is still available.",
    },
    actions: {
      login: "Sign in with GitHub CLI",
      loggingIn: "Signing in…",
      logout: "Sign out of GitHub CLI",
      loggingOut: "Signing out…",
      logoutConfirm: "Confirm sign-out",
      logoutCancel: "Cancel",
      export: "Export locally",
      exporting: "Exporting…",
      publish: "Publish to GitHub",
      publishing: "Publishing…",
    },
    result: {
      exported: "Package exported",
      published: "Package published",
      keyId: "Signing key: {{keyId}}",
      publicKey: "Publisher public key: {{publicKey}}",
    },
    errors: {
      NO_OPEN_PROJECT: "No project is open.",
      DIALOG_UNAVAILABLE: "The system save dialog is unavailable.",
      INVALID_INPUT:
        "Publishing information is invalid. Check the identifiers, version, and repository name.",
      INVALID_PROJECT: "The current project cannot produce a valid package.",
      ASSET_UNAVAILABLE:
        "A project asset is missing, damaged, or does not match its registered hash.",
      CREDENTIAL_UNAVAILABLE:
        "The local signing key in Windows Credential Manager is unavailable.",
      PACKAGE_WRITE_FAILED: "The project or package could not be written.",
      CACHE_CLEANUP_FAILED:
        "The private publishing package could not be cleaned up safely. If upload just completed, do not retry the same version; restart the app and inspect again.",
      GITHUB_CLI_UNAVAILABLE: "GitHub CLI was not found.",
      GITHUB_AUTHENTICATION_REQUIRED:
        "GitHub CLI is not signed in. Run gh auth login first.",
      GITHUB_AUTHENTICATION_FAILED:
        "The GitHub CLI browser/device sign-in did not complete. Try again and follow the authorization prompts.",
      GITHUB_LOGOUT_FAILED:
        "The local GitHub CLI login configuration could not be removed. Run gh auth status and try again.",
      PACKAGE_VERSION_EXISTS:
        "This package version is already published. Published versions cannot be replaced; increase the version and try again.",
      GITHUB_COMMAND_FAILED:
        "The GitHub repository or Release operation failed. Check access, repository state, and network connectivity.",
      DESKTOP_COMMAND_FAILED: "The desktop publishing service is unavailable.",
    },
  },
  project: {
    action: {
      new: "New project",
      open: "Open project",
      save: "Save project",
      saveAs: "Save as",
      close: "Close project",
    },
    identity: {
      unsavedMarker: "Unsaved changes",
      locationTooltip: "Project location: {{path}}",
      savingStatus: "Writing project files",
    },
    dialog: {
      chooseLocationTitle: "Choose an empty folder for the project",
      openTitle: "Open a Rino project",
      manifestFileTypeLabel: "Rino project manifest",
    },
    unsaved: {
      title: "This project has unsaved changes",
      description: "Save them before continuing, or discard them.",
      save: "Save and continue",
      discard: "Discard changes",
    },
    recovery: {
      title: "Unsaved work was found",
      description:
        "This project had changes that never reached the disk. Restore that work, or continue from the version on disk.",
      restore: "Restore unsaved work",
      discard: "Use the version on disk",
    },
    problem: {
      unavailableTitle: "The project file service is unavailable",
      unavailableDescription:
        "This environment has no desktop shell, so project files cannot be read or written. Use the Rino desktop application.",
      commandFailedTitle: "The project operation did not complete",
      formatRejectedTitle: "The project files were rejected",
    },
    error: {
      NO_OPEN_PROJECT: "No project is open.",
      NO_CHOSEN_LOCATION:
        "No project location was chosen, so nothing was written.",
      LOCATION_ALREADY_HOLDS_PROJECT:
        "The chosen folder already holds a Rino project. Use Open project instead, or choose an empty folder.",
      LOCATION_NOT_EMPTY:
        "The chosen folder is not empty. Choose an empty folder so nothing is overwritten.",
      NOT_A_PROJECT_MANIFEST:
        "The selected file is not a project.rino.json manifest.",
      UNSUPPORTED_FILE_NAME:
        "The project holds a file name this format does not allow, so the operation stopped.",
      FILE_TOO_LARGE:
        "A project file exceeds the size this format allows, so the operation stopped.",
      TOO_MANY_FILES:
        "The project holds more files than this format allows, so the operation stopped.",
      READ_FAILED:
        "A project file could not be read. Check that it still exists and is readable.",
      WRITE_FAILED:
        "A project file could not be written and the previous file was kept. Check that the folder is writable.",
      CREATE_FAILED:
        "The project directory could not be created. Check that the location is writable.",
      INVALID_JSON:
        "The content to write was not valid JSON, so nothing was committed.",
      INVALID_IMAGE:
        "The capture bytes did not match their image metadata, so the asset was not written.",
      CAPTURE_UNAVAILABLE:
        "The capture expired or was released. Capture the current device screen again.",
      DIALOG_UNAVAILABLE: "The system file dialog could not be presented.",
      DESKTOP_COMMAND_FAILED:
        "The desktop shell rejected the command without a structured error.",
    },
    format: {
      notJson: "{{fileName}} is not valid JSON.",
      invalidShape: "{{fileName}} does not match the project format.",
      unsupportedVersion:
        "This project uses format version {{foundVersion}}, which this build of Rino cannot read. Update Rino to open it; nothing was modified.",
      graphFileMissing:
        "The manifest names the graph file {{fileName}}, which is not present.",
      graphFileMismatch:
        "The graph file {{fileName}} belongs to a different project or graph.",
      duplicateGraphEntry: "The manifest lists {{fileName}} more than once.",
      entryGraphMissing: "The manifest's entry graph is not among its graphs.",
      duplicateAssetName:
        "The asset name “{{displayName}}” collides with another asset.",
      documentInvalid: "The assembled project document is not valid.",
    },
  },
  runtime: {
    states: {
      connecting: "Connecting to the runtime",
      unavailable: "Runtime unavailable",
      stopped: "Runtime stopped",
      starting: "Runtime starting",
      handshaking: "Negotiating protocol",
      ready: "Runtime ready",
      degraded: "Runtime degraded",
      restarting: "Runtime restarting",
      stopping: "Runtime stopping",
      failed: "Runtime failed",
    },
    actions: {
      restart: "Restart runtime",
    },
    error: {
      desktopCommandFailed:
        "The desktop shell could not complete that runtime operation.",
      sidecarUnavailable: "The runtime process is unavailable.",
      requestTimeout: "The runtime did not answer within the timeout.",
      transportFailure: "The local channel to the runtime failed.",
      protocolIncompatible:
        "The runtime protocol version is incompatible with this application.",
      invalidDesktopRequest:
        "The interface produced an invalid runtime request.",
      invalidRuntimeResult: "The runtime returned an invalid result.",
      previewUnavailable:
        "The device preview expired. Refresh it and try again.",
      captureUnavailable: "The capture expired. Capture it again and retry.",
      projectAssetUnavailable:
        "The template image is unavailable. Confirm that it is still in the project and select it again.",
    },
    nodeError: {
      variableUninitialized: "The image variable has not been assigned yet.",
    },
    runState: {
      starting: "Starting",
      running: "Running",
      cancelling: "Cancelling",
      succeeded: "Succeeded",
      failed: "Failed",
      cancelled: "Cancelled",
    },
    logLevel: {
      debug: "Debug",
      info: "Info",
      warning: "Warning",
      error: "Error",
    },
    execution: {
      steps: "{{count}} steps",
      itemCount: "{{count}} items",
      tokensCreated: "{{count}} tokens",
      cacheHits: "{{count}} cache hits",
      terminalError: "Error: {{code}}",
      executionHistoryLabel: "Execution history",
      logHistoryLabel: "Log history",
      valueHistoryLabel: "Value history",
      showEarlier: "Show {{count}} earlier items",
      newActivity: "New activity",
      currentStep: "Current step",
      unknownNode: "Unknown node ({{id}})",
      nodeUnavailable: "Node is unavailable or missing from graph",
      truncated: " (truncated)",
      dimensions: "{{width}} × {{height}}",
      empty: {
        execution: "No execution history",
        logs: "No logs",
        values: "No values",
      },
      kind: {
        null: "null",
        bool: "boolean",
        number: "number",
        string: "string",
        point: "point",
        rect: "rectangle",
        image: "image",
        ocrCandidate: "OCR candidate",
        ocrResult: "OCR result",
        collection: "collection",
      },
    },
    notices: {
      hostUnavailable: {
        title: "Graphs cannot run in this environment",
        description:
          "The runtime is hosted by the desktop application. Opened as a browser preview, the interface works but cannot reach a runtime.",
      },
      startFailed: {
        title: "The runtime failed to start",
        description:
          "Graph execution needs the runtime. You can restart it; if it keeps failing, check the error code in the Problems panel.",
      },
      incompatible: {
        title: "Incompatible runtime version",
        description:
          "The runtime speaks a protocol version this application does not support. Restarting cannot fix this; install matching application and runtime versions.",
      },
    },
    problems: {
      startFailed: {
        title: "The runtime did not start",
        description:
          "The desktop shell could not start the graph runtime. Graph execution is unavailable until it recovers.",
      },
      runRequestFailed: {
        title: "The run request failed",
        description:
          "The runtime could not start or cancel the graph run. Review the error code and try again.",
      },
      runFailed: {
        title: "The graph run failed",
        description:
          "Execution stopped because a node or runtime operation failed. Review the execution panel and error code.",
      },
      registryLoadFailed: {
        title: "The node library could not be loaded",
        description:
          "The runtime did not provide its authoritative node registry. Restart the runtime before editing or running this graph.",
      },
      graphNotExecutable: {
        title: "The graph cannot run yet",
        description:
          "The runtime found {{count}} blocking or advisory diagnostics. Review the Problems panel and correct every error before running again.",
      },
      persistentVariableContextFailed: {
        title: "The persistent-variable run context failed",
        description:
          "This run could not be safely associated with its persistent variables. Its result will not update persistent values.",
      },
      persistentVariableUpdateRejected: {
        title: "The persistent-variable update was rejected",
        description:
          "The runtime returned a persistent variable that does not match the current graph definition. The update was discarded.",
      },
      persistentVariableStorageTemporary: {
        title: "Persistent variables are temporary for this run",
        description:
          "Application data could not be written to local storage. Values remain available during this run but will not survive a restart.",
      },
    },
  },
  theme: {
    label: "Interface theme",
    description:
      "Follows the operating system appearance by default; you can also choose light or dark explicitly.",
    preferences: {
      system: "Use system setting",
      light: "Light",
      dark: "Dark",
    },
  },
  diagnostics: {
    severity: {
      error: "Error",
      warning: "Warning",
      info: "Information",
    },
    actions: {
      dismiss: "Dismiss",
      dismissAll: "Dismiss all",
      retry: "Retry",
      reloadWindow: "Reload window",
    },
    notifications: {
      regionLabel: "Transient notifications",
    },
    problems: {
      emptyTitle: "No problems",
      emptyDescription:
        "Problems from the interface, the runtime, and the project appear here when they need attention.",
      applicationTitle: "Application and runtime problems",
      count: "{{count}} problems",
    },
    applicationError: {
      title: "Rino encountered a problem",
      description:
        "The interface encountered an unrecoverable error. Reloading may discard unsaved changes.",
      unknownMessage: "An unknown error occurred.",
      details: "Technical details",
      copyDetails: "Copy details",
      detailsCopied: "Details copied.",
      copyFailed:
        "The clipboard is unavailable. Expand the details and copy them manually.",
      errorType: "Error type",
      errorMessage: "Error message",
      stackTrace: "Stack trace",
      componentStack: "Component stack",
    },
    featureError: {
      title: "The {{feature}} region cannot be displayed",
      description:
        "This region hit an unexpected error. The rest of the application remains usable, and you can retry loading the region.",
    },
  },
  locale: {
    languageLabel: "Display language",
    description:
      "Chosen from the system language by default; you can also pin Simplified Chinese or English.",
    preferences: {
      system: "Use system setting",
      zhCN: "Simplified Chinese",
      enUS: "English (United States)",
    },
  },
} as const satisfies ZhCNTranslationCatalog;
