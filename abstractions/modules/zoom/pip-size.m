// Sets the Picture-in-Picture size of Accessibility Zoom.
// The size is stored in com.apple.universalaccess as an archived NSValue under
// closeViewWindowSize, a private key and format. Prints "changed" after a write.
#import <AppKit/AppKit.h>

static NSString *const Domain = @"com.apple.universalaccess";
static NSString *const Key = @"closeViewWindowSize";

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    double width = argc == 3 ? atof(argv[1]) : 0;
    double height = argc == 3 ? atof(argv[2]) : 0;
    if (width <= 0 || height <= 0) {
      fprintf(stderr, "usage: zoom-pip-size WIDTH HEIGHT\n");
      return 2;
    }
    NSSize wanted = NSMakeSize(width, height);
    NSUserDefaults *defaults = [[NSUserDefaults alloc] initWithSuiteName:Domain];
    if (defaults == nil) {
      fprintf(stderr, "%s is unavailable\n", Domain.UTF8String);
      return 1;
    }

    NSData *data = [defaults dataForKey:Key];
    if (data != nil) {
      NSValue *current = [NSKeyedUnarchiver unarchivedObjectOfClass:[NSValue class] fromData:data error:nil];
      if (current != nil && NSEqualSizes(current.sizeValue, wanted)) {
        return 0;
      }
    }

    NSError *error = nil;
    data = [NSKeyedArchiver archivedDataWithRootObject:[NSValue valueWithSize:wanted]
                                 requiringSecureCoding:NO
                                                 error:&error];
    if (data == nil) {
      fprintf(stderr, "cannot archive the size: %s\n", error.description.UTF8String);
      return 1;
    }
    [defaults setObject:data forKey:Key];
    if (![defaults synchronize]) {
      fprintf(stderr, "cannot write %s\n", Key.UTF8String);
      return 1;
    }
    printf("changed\n");
  }
  return 0;
}
