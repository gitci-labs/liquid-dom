#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>

static BOOL selNameContains(SEL sel, NSString *needle) {
    if (sel == NULL) {
        return NO;
    }
    NSString *name = NSStringFromSelector(sel);
    return [name rangeOfString:needle options:NSCaseInsensitiveSearch].location != NSNotFound;
}

static void printRuntimeMatches(NSArray<NSString *> *needles) {
    int classCount = objc_getClassList(NULL, 0);
    __unsafe_unretained Class *classes = (__unsafe_unretained Class *)calloc((size_t)classCount, sizeof(Class));
    classCount = objc_getClassList(classes, classCount);

    printf("== Runtime selector matches ==\n");
    for (int i = 0; i < classCount; i++) {
        Class cls = classes[i];
        unsigned int methodCount = 0;
        Method *instanceMethods = class_copyMethodList(cls, &methodCount);
        for (unsigned int m = 0; m < methodCount; m++) {
            SEL sel = method_getName(instanceMethods[m]);
            for (NSString *needle in needles) {
                if (selNameContains(sel, needle)) {
                    printf("[instance] %s %s\n", class_getName(cls), sel_getName(sel));
                }
            }
        }
        free(instanceMethods);

        Class meta = object_getClass(cls);
        methodCount = 0;
        Method *classMethods = class_copyMethodList(meta, &methodCount);
        for (unsigned int m = 0; m < methodCount; m++) {
            SEL sel = method_getName(classMethods[m]);
            for (NSString *needle in needles) {
                if (selNameContains(sel, needle)) {
                    printf("[class] %s %s\n", class_getName(cls), sel_getName(sel));
                }
            }
        }
        free(classMethods);
    }

    free(classes);
    printf("\n");
}

static void printFilterObject(id filter, const char *label) {
    if (!filter) {
        printf("%s: (null)\n", label);
        return;
    }

    printf("%s: <%s %p> %s\n",
           label,
           object_getClassName(filter),
           (__bridge void *)filter,
           [[filter description] UTF8String]);

    NSArray<NSString *> *keys = @[
        @"name",
        @"type",
        @"inputAmount",
        @"inputRadius",
        @"inputColor",
        @"inputTintColor",
        @"inputMaskImage",
        @"inputNormalizeEdges",
        @"inputHardEdges",
        @"inputSoftness",
        @"inputScale",
        @"inputSaturation",
        @"inputBrightness",
        @"inputContrast",
        @"inputBlendMode",
        @"inputCompositingMode",
        @"inputMatteColor",
        @"filters",
        @"scale",
        @"requestedScaleHint"
    ];

    for (NSString *key in keys) {
        @try {
            id value = [filter valueForKey:key];
            if (value) {
                printf("  %s = %s\n", key.UTF8String, [[value description] UTF8String]);
            }
        } @catch (__unused NSException *ex) {
        }
    }

    if ([filter respondsToSelector:@selector(inputKeys)]) {
        NSArray<NSString *> *inputKeys = ((id (*)(id, SEL))objc_msgSend)(filter, @selector(inputKeys));
        if ([inputKeys count] > 0) {
            printf("  inputKeys = %s\n", [[inputKeys description] UTF8String]);
            for (NSString *inputKey in inputKeys) {
                @try {
                    id value = [filter valueForKey:inputKey];
                    if (value) {
                        printf("    %s = %s (%s)\n", inputKey.UTF8String, [[value description] UTF8String], object_getClassName(value));
                        if ([inputKey isEqualToString:@"inputColorMatrix"]) {
                            float floats[20] = {0};
                            BOOL printed = NO;
                            @try {
                                if ([value isKindOfClass:[NSData class]] && [(NSData *)value length] == sizeof(floats)) {
                                    memcpy(floats, [(NSData *)value bytes], sizeof(floats));
                                    printed = YES;
                                } else if ([value isKindOfClass:[NSValue class]]) {
                                    [(NSValue *)value getValue:&floats];
                                    printed = YES;
                                }
                            } @catch (__unused NSException *ex) {
                            }

                            if (printed) {
                                printf("      as 4x5 matrix:\n");
                                for (int row = 0; row < 4; row++) {
                                    printf("        [");
                                    for (int col = 0; col < 5; col++) {
                                        int idx = row * 5 + col;
                                        printf("%8.4f", floats[idx]);
                                        if (col < 4) {
                                            printf(", ");
                                        }
                                    }
                                    printf("]\n");
                                }
                            }
                        }
                    } else {
                        printf("    %s = (null)\n", inputKey.UTF8String);
                    }
                } @catch (__unused NSException *ex) {
                    printf("    %s = <kvc-exception>\n", inputKey.UTF8String);
                }
            }
        }
    }

    unsigned int methodCount = 0;
    Method *methods = class_copyMethodList([filter class], &methodCount);
    printf("  selectors containing 'input' or 'name':\n");
    for (unsigned int i = 0; i < methodCount; i++) {
        SEL sel = method_getName(methods[i]);
        NSString *selName = NSStringFromSelector(sel);
        if ([selName rangeOfString:@"input" options:NSCaseInsensitiveSearch].location != NSNotFound ||
            [selName rangeOfString:@"name" options:NSCaseInsensitiveSearch].location != NSNotFound) {
            printf("    %s\n", selName.UTF8String);
        }
    }
    free(methods);
}

static void printLayerTree(CALayer *layer, int depth) {
    if (!layer) {
        return;
    }

    NSMutableString *indent = [NSMutableString string];
    for (int i = 0; i < depth; i++) {
        [indent appendString:@"  "];
    }

    printf("%sLayer <%s %p> frame=%s\n",
           indent.UTF8String,
           object_getClassName(layer),
           (__bridge void *)layer,
           NSStringFromRect(NSRectFromCGRect(layer.frame)).UTF8String);

    @try {
        id compositingFilter = [layer valueForKey:@"compositingFilter"];
        if (compositingFilter) {
            printf("%s  compositingFilter present\n", indent.UTF8String);
            printFilterObject(compositingFilter, "compositingFilter");
        }
    } @catch (__unused NSException *ex) {
    }

    @try {
        NSArray *filters = [layer valueForKey:@"filters"];
        if ([filters count] > 0) {
            printf("%s  filters count=%lu\n", indent.UTF8String, (unsigned long)[filters count]);
            for (id filter in filters) {
                printFilterObject(filter, "filter");
            }
        }
    } @catch (__unused NSException *ex) {
    }

    @try {
        NSArray *backgroundFilters = [layer valueForKey:@"backgroundFilters"];
        if ([backgroundFilters count] > 0) {
            printf("%s  backgroundFilters count=%lu\n", indent.UTF8String, (unsigned long)[backgroundFilters count]);
            for (id filter in backgroundFilters) {
                printFilterObject(filter, "backgroundFilter");
            }
        }
    } @catch (__unused NSException *ex) {
    }

    for (CALayer *sublayer in layer.sublayers ?: @[]) {
        printLayerTree(sublayer, depth + 1);
    }
}

static void printViewTree(NSView *view, int depth) {
    if (!view) {
        return;
    }

    NSMutableString *indent = [NSMutableString string];
    for (int i = 0; i < depth; i++) {
        [indent appendString:@"  "];
    }

    printf("%sView <%s %p> frame=%s wantsLayer=%d\n",
           indent.UTF8String,
           object_getClassName(view),
           (__bridge void *)view,
           NSStringFromRect(view.frame).UTF8String,
           view.wantsLayer);

    NSArray<NSString *> *keys = @[
        @"materialBackdropContext",
        @"_effectiveMaterialBackdropContext",
        @"glassFrost",
        @"glassViewState",
        @"glassIdentity",
        @"preferredGlassBehavior",
        @"adaptiveAppearance",
        @"tintColor",
        @"glassMaterial",
        @"glassBehavior"
    ];

    for (NSString *key in keys) {
        @try {
            id value = [view valueForKey:key];
            if (value) {
                printf("%s  %s = %s\n", indent.UTF8String, key.UTF8String, [[value description] UTF8String]);
            }
        } @catch (__unused NSException *ex) {
        }
    }

    for (NSView *subview in view.subviews) {
        printViewTree(subview, depth + 1);
    }
}

static id callOneObjectArg(id target, SEL sel, id arg) {
    if (!target || ![target respondsToSelector:sel]) {
        return nil;
    }
    id (*msgSend)(id, SEL, id) = (id (*)(id, SEL, id))objc_msgSend;
    return msgSend(target, sel, arg);
}

static void callVoidNoArgs(id target, SEL sel) {
    if (!target || ![target respondsToSelector:sel]) {
        return;
    }
    void (*msgSend)(id, SEL) = (void (*)(id, SEL))objc_msgSend;
    msgSend(target, sel);
}

static id callThreeObjectArgs(id target, SEL sel, id a, id b, id c) {
    if (!target || ![target respondsToSelector:sel]) {
        return nil;
    }
    id (*msgSend)(id, SEL, id, id, id) = (id (*)(id, SEL, id, id, id))objc_msgSend;
    return msgSend(target, sel, a, b, c);
}

int main(void) {
    @autoreleasepool {
        [NSApplication sharedApplication];

        NSArray<NSString *> *needles = @[
            @"glassCompositingFilterWithTintColor",
            @"compositingFilterForStyleName:styleConfiguration:tintColor:",
            @"_updateLayerCompositingFilterFromView",
            @"_coordinateScrollPocketAppearance:luma:glassFrost",
            @"preferredGlassBehavior",
            @"materialBackdropContext"
        ];
        printRuntimeMatches(needles);

        Class glassClass = NSClassFromString(@"NSGlassEffectView");
        if (!glassClass) {
            printf("NSGlassEffectView not found.\n");
            return 1;
        }

        NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 480, 320)
                                                       styleMask:NSWindowStyleMaskTitled
                                                         backing:NSBackingStoreBuffered
                                                           defer:NO];
        [window setReleasedWhenClosed:NO];
        [window orderFront:nil];

        NSView *root = [window contentView];
        [root setWantsLayer:YES];

        NSView *glassView = [[glassClass alloc] initWithFrame:NSMakeRect(40, 40, 320, 180)];
        [glassView setWantsLayer:YES];
        [root addSubview:glassView];
        [glassView setNeedsLayout:YES];
        [glassView layoutSubtreeIfNeeded];
        [root layoutSubtreeIfNeeded];
        [window displayIfNeeded];
        callVoidNoArgs(glassView, NSSelectorFromString(@"displayIfNeeded"));
        callVoidNoArgs(glassView, NSSelectorFromString(@"_updateLayerCompositingFilterFromView"));
        [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];

        printf("== View tree ==\n");
        printViewTree(root, 0);
        printf("\n== Layer tree ==\n");
        printLayerTree(root.layer, 0);
        printf("\n");

        SEL glassFilterSel = NSSelectorFromString(@"glassCompositingFilterWithTintColor:");
        Class nsAppearanceClass = NSClassFromString(@"NSAppearance");
        id appearance = [window effectiveAppearance];

        printf("== Direct filter helpers ==\n");
        if ([appearance respondsToSelector:glassFilterSel]) {
            id filter = callOneObjectArg(appearance, glassFilterSel, NSColor.systemBlueColor);
            printFilterObject(filter, "NSAppearance glassCompositingFilterWithTintColor(systemBlue)");
            id clearFilter = callOneObjectArg(appearance, glassFilterSel, nil);
            printFilterObject(clearFilter, "NSAppearance glassCompositingFilterWithTintColor(nil)");
        } else if ([glassView respondsToSelector:glassFilterSel]) {
            id filter = callOneObjectArg(glassView, glassFilterSel, NSColor.systemBlueColor);
            printFilterObject(filter, "glassView glassCompositingFilterWithTintColor(systemBlue)");
        } else {
            printf("glassCompositingFilterWithTintColor: unavailable\n");
        }

        SEL appearanceFilterSel = NSSelectorFromString(@"compositingFilterForStyleName:styleConfiguration:tintColor:");
        if ([appearance respondsToSelector:appearanceFilterSel]) {
            id filter = callThreeObjectArgs(appearance, appearanceFilterSel, @"glass", nil, NSColor.systemBlueColor);
            printFilterObject(filter, "NSAppearance compositingFilterForStyleName");
        } else if ([nsAppearanceClass instancesRespondToSelector:appearanceFilterSel]) {
            printf("NSAppearance responds via instances, but call path was not reached.\n");
        } else {
            printf("NSAppearance compositingFilterForStyleName:styleConfiguration:tintColor: unavailable\n");
        }
    }
    return 0;
}
